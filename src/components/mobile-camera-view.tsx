'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { CameraIcon, RefreshCwIcon } from "lucide-react"
import { createWorker } from 'tesseract.js'

const readFromBlobOrFile = (blob) => (
  new Promise((resolve, reject) => {
    console.log("BLOB")
    console.log(blob)
    const fileReader = new FileReader();
    fileReader.onload = () => {
      resolve(fileReader.result);
    };
    fileReader.onerror = ({ target: { error: { code } } }) => {
      reject(Error(`File could not be read! Code=${code}`));
    };
    fileReader.readAsArrayBuffer(blob);
  })
);

export function MobileCameraView() {
  const [isFrontCamera, setIsFrontCamera] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
    console.log("starting processing");
    console.log(canvasRef.current?.toDataURL())
    if (isProcessing || !videoRef.current || !canvasRef.current || !workerRef.current) return

    setIsProcessing(true)

    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')

    if (!ctx) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    console.log("starting recognize");
    console.log(canvas)

    canvas.toBlob(async (blob) => {
      const data = await readFromBlobOrFile(blob);
      console.log(data)
    })

    try {
      const { data } = await workerRef.current.recognize(canvas).catch(error => console.error('Error in myFunction:', error));
      console.log(data);

      // Clear previous boxes
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  
      // Draw bounding boxes
      ctx.strokeStyle = 'red'
      ctx.lineWidth = 2
      data.words.forEach(word => {
        const { bbox } = word
        ctx.strokeRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0)
      })
    } catch (error) {
      console.log("ERROR")
      console.log(error)
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
        Currently using: {isFrontCamera ? 'Front' : 'Back'} camera
      </p>
    </div>
  )
}