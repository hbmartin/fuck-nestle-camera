"use client"

import { Button } from "@/components/ui/button"
import { OcrsModule } from "@/ocrs/ocrs_module"
import { type FuzzyOptions, Searcher } from "fast-fuzzy"
import { RefreshCwIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

const detectAndRecognizeFrame = (
  canvas: HTMLCanvasElement,
  imageData: ImageData,
  searcher: Searcher<string, FuzzyOptions> | null,
) => {
  const ctx = canvas.getContext("2d")
  const startTime = performance.now()
  const data = OcrsModule.getInstance().detectAndRecognizeText(imageData)
  const detectTime = performance.now()
  console.log(`Detection took ${detectTime - startTime} ms.`)

  if (data) {
    // Clear previous boxes
    ctx?.clearRect(0, 0, canvas.width, canvas.height)

    // Draw bounding boxes
    if (ctx) {
      ctx.strokeStyle = "red"
      ctx.lineWidth = 2
      data.lines.forEach((word) => {
        if (word.words.length > 0 && word.words[0].rect) {
          const bbox = word.words[0].rect
          ctx?.strokeRect(
            bbox[0],
            bbox[1],
            bbox[2] - bbox[0],
            bbox[3] - bbox[1],
          )
        }
      })
    }

    for (const line of data.lines) {
      const text = line.text
      if (text.length > 4) {
        const matches = searcher?.search(text)
        if (matches && matches.length > 0) {
          console.log(matches)
        } else {
          console.log(`matches: ${matches}`)
        }
      }
    }
  }
}

export function MobileCameraView() {
  const [isFrontCamera, setIsFrontCamera] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(
    document.createElement("canvas"),
  )
  const streamRef = useRef<MediaStream | null>(null)
  const fuzzyRef = useRef<Searcher<string, FuzzyOptions> | null>(null)

  useEffect(() => {
    async function setupCamera() {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
        }

        const constraints = {
          video: { facingMode: isFrontCamera ? "user" : "environment" },
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        streamRef.current = stream
      } catch (err) {
        console.error("Error accessing the camera:", err)
      }
    }

    async function setupFuzzy() {
      const response = await fetch("/brands.json")
      if (!response.ok) {
        throw new Error(`HTTP error fetching brands: ${response.status}`)
      }
      const brands = (await response.json()).brands
      console.log(brands)
      fuzzyRef.current = new Searcher(brands)
    }

    setupCamera()
    const _initModule = OcrsModule.getInstance()
    setupFuzzy()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [isFrontCamera])

  const toggleCamera = () => {
    setIsFrontCamera((prev) => !prev)
  }

  const processFrame = () => {
    if (!(videoRef.current && canvasRef.current)) {
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const hiddenCtx = hiddenCanvasRef.current.getContext("2d")

    if (!hiddenCtx) {
      return
    }

    if (video.videoWidth > 1) {
      canvas.width = video.videoWidth
      hiddenCanvasRef.current.width = video.videoWidth
    }
    if (video.videoHeight > 1) {
      canvas.height = video.videoHeight
      hiddenCanvasRef.current.height = video.videoHeight
    }
    hiddenCtx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData: ImageData = hiddenCtx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    )
    detectAndRecognizeFrame(canvas, imageData, fuzzyRef.current)
  }

  useEffect(() => {
    const intervalId = setInterval(processFrame, 500)
    return () => clearInterval(intervalId)
  })

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full relative overflow-hidden rounded-lg shadow-lg">
        <video
          muted={true}
          ref={videoRef}
          autoPlay={true}
          playsInline={true}
          className="w-full h-full object-cover"
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
        />
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <Button
            onClick={toggleCamera}
            className="bg-white text-black hover:bg-gray-200 transition-colors"
          >
            <RefreshCwIcon className="mr-2 h-4 w-4" />
            Switch Camera
          </Button>
        </div>
      </div>
      <p className="mt-4 text-center text-sm text-gray-600">
        Currently using: {isFrontCamera ? "Front" : "Back"} camera
      </p>
    </div>
  )
}
