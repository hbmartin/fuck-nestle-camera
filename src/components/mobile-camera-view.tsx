'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { RefreshCwIcon } from "lucide-react"
import { createWorker, Rectangle } from 'tesseract.js'

export function MobileCameraView() {
  const [isFrontCamera, setIsFrontCamera] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [boundingBoxes, setBoundingBoxes] = useState<Rectangle[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const workerRef = useRef<Tesseract.Worker | null>(null)

  useEffect(() => {
    async function setupCamera() {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
        }

        const constraints = {
          video: { facingMode: isFrontCamera ? 'user' : 'environment' }
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

    async function initTesseract() {
      const worker = await createWorker('eng')
      workerRef.current = worker
    }

    setupCamera()
    initTesseract()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
  }, [isFrontCamera])

  const toggleCamera = () => {
    setIsFrontCamera(prev => !prev)
  }

  const processFrame = async () => {
    if (isProcessing || !videoRef.current || !workerRef.current) return

    setIsProcessing(true)
    console.log("PROCESSING")
    console.log(videoRef.current.poster)
    try {
      const { data } = await workerRef.current.recognize(videoRef.current)
      console.log(data)
      setBoundingBoxes(data.words.map(word => word.bbox))
    } catch (error) {
      console.error("Error processing frame:", error)
    }

    setIsProcessing(false)
  }

  useEffect(() => {
    const intervalId = setInterval(processFrame, 1000) // Process every second
    return () => clearInterval(intervalId)
  }, [isProcessing])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <div className="w-full max-w-md aspect-[9/16] relative overflow-hidden rounded-lg shadow-lg">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
        <svg
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
          style={{ filter: 'drop-shadow(0px 0px 2px rgba(0,0,0,0.5))' }}
        >
          {boundingBoxes.map((box, index) => (
            <rect
              key={index}
              x={box.x0}
              y={box.y0}
              width={box.x1 - box.x0}
              height={box.y1 - box.y0}
              fill="none"
              stroke="red"
              strokeWidth="2"
            />
          ))}
        </svg>
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
        Currently using: {isFrontCamera ? 'Front' : 'Back'} camera
      </p>
    </div>
  )
}