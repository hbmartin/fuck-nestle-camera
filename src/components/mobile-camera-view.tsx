"use client"

import { BrandMatcher, type Rect } from "@/lib/brand-matcher"
import { type ConfirmedBrand, TemporalVoter } from "@/lib/temporal-voter"
import { OcrClient } from "@/ocr/ocr-client"
import { SwitchCamera } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "./ui/button"

/**
 * Region of interest, as fractions of the video frame. Only this center band
 * is OCRed: it is faster than the full frame and makes results intentional —
 * the user aims the viewfinder at a label instead of scanning the whole
 * scene.
 */
const ROI_LEFT = 0.1
const ROI_TOP = 0.3
const ROI_WIDTH = 0.8
const ROI_HEIGHT = 0.4
/** The ROI crop is downscaled to at most this width before inference. */
const TARGET_ROI_WIDTH = 640
/** Pause between the end of one inference pass and the next capture. */
const FRAME_PACING_MS = 100
/** Poll interval while detection is paused or the pipeline is not ready. */
const IDLE_POLL_MS = 250
/** Maximum age for a match box to stay spatially attached to the camera feed. */
const RECENT_MATCH_MS = 300

type CameraStatus = "starting" | "active" | "denied" | "unavailable" | "error"
type OcrStatus = "loading" | "ready" | "error"
type FacingMode = "environment" | "user"

interface Roi {
  sourceX: number
  sourceY: number
  sourceWidth: number
  sourceHeight: number
  targetWidth: number
  targetHeight: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeRoi(videoWidth: number, videoHeight: number): Roi {
  const sourceX = Math.round(videoWidth * ROI_LEFT)
  const sourceY = Math.round(videoHeight * ROI_TOP)
  const sourceWidth = Math.round(videoWidth * ROI_WIDTH)
  const sourceHeight = Math.round(videoHeight * ROI_HEIGHT)
  const scale = Math.min(1, TARGET_ROI_WIDTH / sourceWidth)
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    targetWidth: Math.max(1, Math.round(sourceWidth * scale)),
    targetHeight: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

function captureRoi(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  roi: Roi,
): ImageData | null {
  if (canvas.width !== roi.targetWidth) {
    canvas.width = roi.targetWidth
  }
  if (canvas.height !== roi.targetHeight) {
    canvas.height = roi.targetHeight
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) {
    return null
  }
  ctx.drawImage(
    video,
    roi.sourceX,
    roi.sourceY,
    roi.sourceWidth,
    roi.sourceHeight,
    0,
    0,
    roi.targetWidth,
    roi.targetHeight,
  )
  return ctx.getImageData(0, 0, roi.targetWidth, roi.targetHeight)
}

/** Maps a rect from downscaled-ROI coordinates back to video coordinates. */
function mapRectToVideo(rect: Rect, roi: Roi): Rect {
  const scaleX = roi.sourceWidth / roi.targetWidth
  const scaleY = roi.sourceHeight / roi.targetHeight
  return [
    roi.sourceX + rect[0] * scaleX,
    roi.sourceY + rect[1] * scaleY,
    roi.sourceX + rect[2] * scaleX,
    roi.sourceY + rect[3] * scaleY,
  ]
}

function drawMatchLabel(
  ctx: CanvasRenderingContext2D,
  match: ConfirmedBrand,
  fontSize: number,
): void {
  const [left, top, right, bottom] = match.rect
  ctx.strokeStyle = "#ef4444"
  ctx.lineWidth = 3
  ctx.strokeRect(left, top, right - left, bottom - top)

  const labelWidth = ctx.measureText(match.brand).width
  const labelBaseline = top - 8 < fontSize ? bottom + fontSize + 8 : top - 8
  ctx.fillStyle = "rgba(239, 68, 68, 0.9)"
  ctx.fillRect(
    left - 2,
    labelBaseline - fontSize,
    labelWidth + 12,
    fontSize + 8,
  )
  ctx.fillStyle = "#ffffff"
  ctx.fillText(match.brand, left + 4, labelBaseline)
}

/**
 * The overlay canvas shares the video's intrinsic dimensions and its
 * `object-cover` CSS, so drawing in video-pixel coordinates lines boxes up
 * exactly with what the user sees regardless of the element's on-screen size.
 */
function drawOverlay(
  canvas: HTMLCanvasElement,
  videoWidth: number,
  videoHeight: number,
  roi: Roi,
  matches: readonly ConfirmedBrand[],
  now: number,
): void {
  if (canvas.width !== videoWidth) {
    canvas.width = videoWidth
  }
  if (canvas.height !== videoHeight) {
    canvas.height = videoHeight
  }
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return
  }
  ctx.clearRect(0, 0, videoWidth, videoHeight)

  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"
  ctx.lineWidth = 2
  ctx.setLineDash([12, 8])
  ctx.strokeRect(roi.sourceX, roi.sourceY, roi.sourceWidth, roi.sourceHeight)
  ctx.setLineDash([])

  const fontSize = Math.max(16, Math.round(videoWidth / 40))
  ctx.font = `bold ${fontSize}px sans-serif`
  for (const match of matches) {
    if (now - match.lastSeenAt <= RECENT_MATCH_MS) {
      drawMatchLabel(ctx, match, fontSize)
    }
  }
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)
}

function statusFromCameraError(error: unknown): CameraStatus {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "denied"
    }
    if (
      error.name === "NotFoundError" ||
      error.name === "OverconstrainedError"
    ) {
      return "unavailable"
    }
  }
  return "error"
}

const CAMERA_STATUS_MESSAGES: Record<
  Exclude<CameraStatus, "active">,
  string
> = {
  starting: "Starting camera…",
  denied:
    "Camera access was denied. Allow camera access in your browser settings, then try again.",
  unavailable: "No usable camera was found on this device.",
  error: "The camera could not be started.",
}

export function MobileCameraView() {
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("starting")
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>("loading")
  const [facingMode, setFacingMode] = useState<FacingMode>("environment")
  const [isDetectionActive, setIsDetectionActive] = useState(true)
  const [confirmedBrands, setConfirmedBrands] = useState<ConfirmedBrand[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ocrClientRef = useRef<OcrClient | null>(null)
  const matcherRef = useRef<BrandMatcher | null>(null)
  const voterRef = useRef(new TemporalVoter())
  const detectionActiveRef = useRef(true)
  const cameraRequestRef = useRef(0)

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Service worker registration failed:", error)
      })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let client: OcrClient
    try {
      client = new OcrClient()
    } catch (error) {
      console.error("OCR initialization failed:", error)
      setOcrStatus("error")
      return () => {
        cancelled = true
      }
    }
    ocrClientRef.current = client

    const loadBrands = async () => {
      const response = await fetch("/brands.json")
      if (!response.ok) {
        throw new Error(`HTTP error fetching brands: ${response.status}`)
      }
      const { brands } = (await response.json()) as { brands: string[] }
      if (!cancelled) {
        matcherRef.current = new BrandMatcher(brands)
      }
    }

    Promise.all([client.readyPromise, loadBrands()])
      .then(() => {
        if (!cancelled) {
          setOcrStatus("ready")
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("OCR initialization failed:", error)
          setOcrStatus("error")
        }
      })

    return () => {
      cancelled = true
      ocrClientRef.current = null
      matcherRef.current = null
      client.dispose()
    }
  }, [])

  const stopStream = useCallback(() => {
    cameraRequestRef.current += 1
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop()
    }
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const startCamera = useCallback(async () => {
    stopStream()
    const requestId = ++cameraRequestRef.current
    setCameraStatus("starting")
    if (document.hidden) {
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })
      if (requestId !== cameraRequestRef.current || document.hidden) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setCameraStatus("active")
    } catch (error) {
      if (requestId === cameraRequestRef.current && !document.hidden) {
        console.error("Error accessing the camera:", error)
        setCameraStatus(statusFromCameraError(error))
      }
    }
  }, [facingMode, stopStream])

  useEffect(() => {
    startCamera()
    return stopStream
  }, [startCamera, stopStream])

  // Release the camera and let the processing loop idle while the page is
  // hidden; reacquire when the user comes back.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopStream()
      } else {
        startCamera()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [startCamera, stopStream])

  useEffect(() => {
    detectionActiveRef.current = isDetectionActive
    if (!isDetectionActive) {
      voterRef.current.reset()
      setConfirmedBrands([])
      clearCanvas(overlayCanvasRef.current)
    }
  }, [isDetectionActive])

  const processFrame = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current
    const overlay = overlayCanvasRef.current
    const capture = captureCanvasRef.current
    const client = ocrClientRef.current
    const matcher = matcherRef.current
    const pipelineReady =
      video &&
      overlay &&
      capture &&
      client?.isReady &&
      matcher &&
      detectionActiveRef.current &&
      !document.hidden &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0
    if (!pipelineReady) {
      return false
    }

    const roi = computeRoi(video.videoWidth, video.videoHeight)
    const imageData = captureRoi(video, capture, roi)
    if (!imageData) {
      return false
    }
    const result = await client.detect(imageData)
    // Blurry frames are skipped entirely: they neither add nor decay votes.
    if (result.blurry || !detectionActiveRef.current) {
      return true
    }
    const matches = matcher.matchLines(result.lines).map((match) => ({
      ...match,
      rect: mapRectToVideo(match.rect, roi),
    }))
    const now = Date.now()
    const confirmed = voterRef.current.addFrame(matches, now)
    setConfirmedBrands(confirmed)
    drawOverlay(overlay, video.videoWidth, video.videoHeight, roi, confirmed, now)
    return true
  }, [])

  // Adaptive processing loop: the next capture starts only after the
  // previous inference finishes, so slow devices simply process fewer
  // frames instead of piling up work.
  useEffect(() => {
    let cancelled = false
    const runLoop = async () => {
      while (!cancelled) {
        let processed = false
        try {
          processed = await processFrame()
        } catch (error) {
          console.error("Frame processing failed:", error)
        }
        await sleep(processed ? FRAME_PACING_MS : IDLE_POLL_MS)
      }
    }
    runLoop()
    return () => {
      cancelled = true
    }
  }, [processFrame])

  const toggleDetection = () => setIsDetectionActive((previous) => !previous)
  const toggleFacingMode = () =>
    setFacingMode((previous) =>
      previous === "environment" ? "user" : "environment",
    )

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black shadow-lg">
        <video
          aria-hidden="true"
          muted={true}
          ref={videoRef}
          autoPlay={true}
          playsInline={true}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <canvas
          ref={overlayCanvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
        <canvas
          ref={captureCanvasRef}
          className="hidden"
        />

        {cameraStatus !== "active" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center text-white">
            <p>{CAMERA_STATUS_MESSAGES[cameraStatus]}</p>
            {cameraStatus !== "starting" && (
              <Button
                onClick={startCamera}
                className="bg-white text-black hover:bg-gray-200"
              >
                Try again
              </Button>
            )}
          </div>
        )}

        {cameraStatus === "active" && ocrStatus === "loading" && (
          <div className="absolute top-4 inset-x-0 flex justify-center">
            <span className="rounded-full bg-black/70 px-4 py-1 text-sm text-white">
              Loading OCR models…
            </span>
          </div>
        )}
        {ocrStatus === "error" && (
          <div className="absolute top-4 inset-x-0 flex justify-center">
            <span className="rounded-full bg-red-600/90 px-4 py-1 text-sm text-white">
              Text detection failed to load. Reload to retry.
            </span>
          </div>
        )}

        {confirmedBrands.length > 0 && (
          <div className="absolute top-4 inset-x-4 rounded-lg bg-red-600/90 p-3 text-white">
            <p className="font-bold">Nestlé brand detected</p>
            <ul>
              {confirmedBrands.map((match) => (
                <li key={match.brand}>
                  <strong>{match.brand}</strong>{" "}
                  <span className="text-sm text-red-100">
                    (saw “{match.sourceText}”)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="absolute bottom-4 inset-x-0 flex justify-center gap-3">
          <Button
            onClick={toggleDetection}
            disabled={cameraStatus !== "active" || ocrStatus !== "ready"}
            className="bg-white text-black transition-colors hover:bg-gray-200"
          >
            {isDetectionActive ? "Pause detection" : "Resume detection"}
          </Button>
          <Button
            onClick={toggleFacingMode}
            aria-label="Switch camera"
            className="bg-white text-black transition-colors hover:bg-gray-200"
          >
            <SwitchCamera className="h-5 w-5" />
          </Button>
        </div>
      </div>
      <p className="text-center text-sm text-gray-500">
        Aim the dashed box at a product’s branding.
      </p>
    </div>
  )
}
