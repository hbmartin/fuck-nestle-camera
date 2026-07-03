/**
 * Web Worker that owns the WASM OCR engine so inference never blocks the UI
 * thread. Frames are preprocessed (grayscale + contrast stretch) and checked
 * for motion blur before being handed to the engine.
 */
import {
  OcrEngine,
  OcrEngineInit,
  default as initOcrLib,
} from "../ocrs/ocrs.js"
import type { DetectRequest, OcrLine, WorkerResponse } from "./protocol"

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<DetectRequest>) => Promise<void>) | null
  postMessage(message: WorkerResponse): void
}

/**
 * Frames whose variance-of-Laplacian falls below this are considered too
 * blurry (camera in motion / hunting focus) to be worth an inference pass.
 */
const BLUR_VARIANCE_THRESHOLD = 30
/** Percentile bounds used for contrast stretching. */
const CONTRAST_LOW_PERCENTILE = 0.02
const CONTRAST_HIGH_PERCENTILE = 0.98
const MAX_LUMA = 255

let ocrEngine: OcrEngine | null = null

async function fetchAsBinary(path: string): Promise<Uint8Array> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`HTTP error fetching ${path}: ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function initEngine(): Promise<void> {
  const [wasmBinary, detectionModel, recognitionModel] = await Promise.all([
    fetchAsBinary("/ocrs_bg.wasm"),
    fetchAsBinary("/text-detection.rten"),
    fetchAsBinary("/text-recognition.rten"),
  ])

  await initOcrLib(wasmBinary)

  const ocrInit = new OcrEngineInit()
  ocrInit.setDetectionModel(detectionModel)
  ocrInit.setRecognitionModel(recognitionModel)
  ocrEngine = new OcrEngine(ocrInit)
}

function toGrayscale(
  pixels: Uint8ClampedArray,
  pixelCount: number,
): Uint8Array {
  const gray = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4
    // Rec. 601 luma weights.
    gray[i] =
      (pixels[offset] * 77 +
        pixels[offset + 1] * 150 +
        pixels[offset + 2] * 29) >>
      8
  }
  return gray
}

/**
 * Variance of the Laplacian: a standard, cheap sharpness estimate. Blurry
 * frames have weak edges everywhere, so the Laplacian response is uniformly
 * small and its variance low.
 */
function laplacianVariance(
  gray: Uint8Array,
  width: number,
  height: number,
): number {
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const lap =
        gray[i - width] +
        gray[i + width] +
        gray[i - 1] +
        gray[i + 1] -
        4 * gray[i]
      sum += lap
      sumSq += lap * lap
      count++
    }
  }
  if (count === 0) {
    return 0
  }
  const mean = sum / count
  return sumSq / count - mean * mean
}

/**
 * Percentile-based linear contrast stretch, in place. Helps with dim
 * lighting and low-contrast text on glossy packaging.
 */
function stretchContrast(gray: Uint8Array): void {
  const histogram = new Uint32Array(MAX_LUMA + 1)
  for (const value of gray) {
    histogram[value]++
  }
  const lowTarget = gray.length * CONTRAST_LOW_PERCENTILE
  const highTarget = gray.length * CONTRAST_HIGH_PERCENTILE
  let cumulative = 0
  let low = 0
  let high = MAX_LUMA
  let lowFound = false
  let highFound = false
  for (let value = 0; value <= MAX_LUMA; value++) {
    cumulative += histogram[value]
    if (!lowFound && cumulative >= lowTarget) {
      low = value
      lowFound = true
    }
    if (!highFound && cumulative >= highTarget) {
      high = value
      highFound = true
    }
  }
  if (high <= low) {
    return
  }
  const scale = MAX_LUMA / (high - low)
  for (let i = 0; i < gray.length; i++) {
    const stretched = (gray[i] - low) * scale
    gray[i] = stretched < 0 ? 0 : stretched > MAX_LUMA ? MAX_LUMA : stretched
  }
}

function grayToRgb(gray: Uint8Array): Uint8Array {
  const rgb = new Uint8Array(gray.length * 3)
  for (let i = 0; i < gray.length; i++) {
    const offset = i * 3
    rgb[offset] = gray[i]
    rgb[offset + 1] = gray[i]
    rgb[offset + 2] = gray[i]
  }
  return rgb
}

function recognizeLines(
  engine: OcrEngine,
  width: number,
  height: number,
  rgb: Uint8Array,
): OcrLine[] {
  const image = engine.loadImage(width, height, rgb)
  try {
    const lines = engine.getTextLines(image)
    try {
      return lines.map((line) => {
        const words = line.words()
        try {
          return {
            text: line.text(),
            words: words.map((word) => {
              const rotatedRect = word.rotatedRect()
              try {
                const rect = rotatedRect.boundingRect()
                return {
                  text: word.text(),
                  rect: [rect[0], rect[1], rect[2], rect[3]] as [
                    number,
                    number,
                    number,
                    number,
                  ],
                }
              } finally {
                rotatedRect.free()
              }
            }),
          }
        } finally {
          for (const word of words) {
            word.free()
          }
        }
      })
    } finally {
      for (const line of lines) {
        line.free()
      }
    }
  } finally {
    image.free()
  }
}

function handleDetect(request: DetectRequest): WorkerResponse {
  if (!ocrEngine) {
    return {
      type: "detect-error",
      id: request.id,
      message: "OCR engine is not initialized",
    }
  }
  const { width, height } = request
  const pixels = new Uint8ClampedArray(request.pixels)
  const gray = toGrayscale(pixels, width * height)

  if (laplacianVariance(gray, width, height) < BLUR_VARIANCE_THRESHOLD) {
    return { type: "result", id: request.id, blurry: true, lines: [] }
  }

  stretchContrast(gray)
  const lines = recognizeLines(ocrEngine, width, height, grayToRgb(gray))
  return { type: "result", id: request.id, blurry: false, lines }
}

const initPromise = initEngine()

workerSelf.onmessage = async (event: MessageEvent<DetectRequest>) => {
  const request = event.data
  try {
    await initPromise
  } catch (error) {
    workerSelf.postMessage({
      type: "detect-error",
      id: request.id,
      message: `OCR init failed: ${String(error)}`,
    } satisfies WorkerResponse)
    return
  }
  try {
    workerSelf.postMessage(handleDetect(request))
  } catch (error) {
    workerSelf.postMessage({
      type: "detect-error",
      id: request.id,
      message: String(error),
    } satisfies WorkerResponse)
  }
}

initPromise
  .then(() =>
    workerSelf.postMessage({ type: "ready" } satisfies WorkerResponse),
  )
  .catch((error) =>
    workerSelf.postMessage({
      type: "init-error",
      message: String(error),
    } satisfies WorkerResponse),
  )
