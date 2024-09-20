"use client"

import { OcrEngine, OcrEngineInit, default as initOcrLib } from "./ocrs.js"

enum Status {
  NotStartedIntitializing = 0,
  CurrentlyIntitializing = 1,
  Ready = 2,
  Running = 3,
}

export interface DetectAndRecognizeResult {
  lines: Line[]
}

export interface Line {
  text: string
  words: Word[]
}

export interface Word {
  text: string
  rect: number[]
}

async function fetchAsBinary(path: string): Promise<Uint8Array> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  const data = await response.arrayBuffer()
  return new Uint8Array(data)
}

export class OcrsModule {
  private static instance: OcrsModule
  private static status = Status.NotStartedIntitializing
  private static ocrEngine: OcrEngine | null = null

  private constructor() {
    OcrsModule.initEngine()
  }

  private static async initEngine() {
    if (OcrsModule.status > Status.NotStartedIntitializing) {
      return
    }
    OcrsModule.status = Status.CurrentlyIntitializing

    const [wasmBinary, detectionModel, recognitionModel] = await Promise.all([
      fetchAsBinary("/ocrs_bg.wasm"),
      fetchAsBinary("/text-detection.rten"),
      fetchAsBinary("/text-recognition.rten"),
    ])

    console.log(`Loaded wasm ${wasmBinary.length}`)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _initOutput = await initOcrLib(wasmBinary)

    console.log(`Loaded detectionModel ${detectionModel.length}`)
    console.log(`Loaded recognitionModel ${recognitionModel.length}`)

    const ocrInit = new OcrEngineInit()
    ocrInit.setDetectionModel(detectionModel)
    ocrInit.setRecognitionModel(recognitionModel)

    OcrsModule.ocrEngine = new OcrEngine(ocrInit)
    OcrsModule.status = Status.Ready
  }

  static getInstance(): OcrsModule {
    if (!OcrsModule.instance) {
      OcrsModule.instance = new OcrsModule()
    }
    return OcrsModule.instance
  }

  detectAndRecognizeText(image: ImageData): DetectAndRecognizeResult | null {
    if (!OcrsModule.ocrEngine) {
      console.log("ocrEngine has not been initialized")
      return null
    }
    if (OcrsModule.status !== Status.Ready) {
      console.log(`Detection request already running (${OcrsModule.status})`)
      return null
    }
    OcrsModule.status = Status.Running
    const ocrInput = OcrsModule.ocrEngine.loadImage(
      image.width,
      image.height,
      Uint8Array.from(image.data),
    )
    const textLines = OcrsModule.ocrEngine.getTextLines(ocrInput)
    const lines = textLines.map((line) => {
      const words = line.words().map((word) => {
        return {
          text: word.text(),
          rect: Array.from(word.rotatedRect().boundingRect()),
        }
      })

      return {
        text: line.text(),
        words,
      }
    })

    OcrsModule.status = Status.Ready

    return {
      lines,
    }
  }
}
