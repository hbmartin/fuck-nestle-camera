"use client"

import { OcrsModule } from "@/ocrs/ocrs_module"
import { type FuzzyOptions, Searcher } from "fast-fuzzy"
import { useEffect, useRef, useState } from "react"
import { Button } from "./ui/button"

const detectAndRecognizeFrame = async (
  canvas: HTMLCanvasElement,
  imageData: ImageData,
  searcher: Searcher<string, FuzzyOptions> | null,
): Promise<Record<string, string[]>> => {
  const ctx = canvas.getContext("2d")
  const startTime = performance.now()
  const data = await OcrsModule.getInstance().detectAndRecognizeText(imageData)
  const detectTime = performance.now()
  console.log(`Detection took ${detectTime - startTime} ms.`)

  if (data) {
    // Clear previous boxes
    ctx?.clearRect(0, 0, canvas.width, canvas.height)

    // Draw bounding boxes
    if (ctx) {
      ctx.strokeStyle = "red"
      ctx.lineWidth = 2
    }
    const textMatches: Record<string, string[]> = {}

    for (const line of data.lines) {
      const text = line.text
      if (text.length > 4) {
        for (const word of line.words) {
          const bbox = word.rect
          ctx?.strokeRect(
            bbox[0],
            bbox[1],
            bbox[2] - bbox[0],
            bbox[3] - bbox[1],
          )
        }
        const matches = searcher?.search(text)
        if (matches && matches.length > 0) {
          console.log(matches)
          textMatches[text] = matches
        }
      } else {
        console.log("No matches")
      }
    }
    return textMatches
  }
  return {}
}

export function MobileCameraView() {
  const [wordMatches, setWordMatches] = useState<Record<string, string[]>>({})
  const [isDetectionActive, setIsDetectionActive] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fuzzyRef = useRef<Searcher<string, FuzzyOptions> | null>(null)

  useEffect(() => {
    async function setupCamera() {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
        }

        const constraints = {
          video: { facingMode: "user" },
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _initModule = OcrsModule.getInstance()
    setupFuzzy()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  const toggleDetection = () => {
    setIsDetectionActive((prev) => !prev)
  }

  const processFrame = () => {
    if (!(videoRef.current && canvasRef.current && hiddenCanvasRef.current)) {
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

    if (isDetectionActive) {
      detectAndRecognizeFrame(canvas, imageData, fuzzyRef.current).then(
        (detectedWordMatches) => {
          setWordMatches(detectedWordMatches)
        },
      )
    }
  }

  useEffect(() => {
    const intervalId = setInterval(processFrame, 500)
    return () => clearInterval(intervalId)
  })

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full relative overflow-hidden rounded-lg shadow-lg">
        <canvas
          ref={hiddenCanvasRef}
          className="absolute top-0 left-0 w-full h-full hidden"
        />
        <video
          muted={true}
          ref={videoRef}
          autoPlay={true}
          playsInline={true}
          className="w-full h-full object-cover"
        />
        <div className="absolute top-4 left-0 right-0 flex justify-center">
          <ul className="list-disc ml-4">
            {Object.keys(wordMatches).map((text) => (
              <li
                key={text}
                className="text-sm text-gray-800"
              >
                <strong>{text}</strong>
                {wordMatches[text].map((match) => (
                  <li key={match}>{match}</li>
                ))}
              </li>
            ))}
          </ul>
        </div>
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
        />
        <div className="absolute bottom-4 left-0 right-0 flex justify-center">
          <Button
            onClick={toggleDetection}
            className="bg-white text-black hover:bg-gray-200 transition-colors"
          >
            Start / Pause
          </Button>
        </div>
      </div>
    </div>
  )
}
