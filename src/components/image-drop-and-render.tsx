"use client"

import { useState, useRef, useCallback } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { OcrsModule } from '@/ocrs/ocrs_module'

export default function ImageDropAndRender() {
  const [image, setImage] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const worker = OcrsModule.getInstance()

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const img = new Image()
        img.onload = () => {
          const canvas = canvasRef.current
          if (canvas) {
            canvas.width = img.width
            canvas.height = img.height
            const ctx = canvas.getContext('2d')
            ctx?.drawImage(img, 0, 0)
            if (!ctx) {
              return
            }

            console.log(`width: ${canvas.width}, height: ${canvas.height}`)
            const imageData: ImageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const data = worker.detectAndRecognizeText(imageData)
            console.log(JSON.stringify(data))
        
        
            console.log("starting recognize");
        
            if (data) {
              // Draw bounding boxes
              ctx.strokeStyle = 'red'
              ctx.lineWidth = 2
              data.lines.forEach(word => {
                if (word.words.length > 0 && word.words[0].rect) {
                  const bbox = word.words[0].rect
                  ctx.strokeRect(bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1])
                }
              })
            }
          }
        }
        img.src = event.target?.result as string
        setImage(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }, [worker])

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const clearImage = useCallback(() => {
    setImage(null)
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [])

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardContent>
        <div 
          className={`mt-4 border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
            isDragging ? 'border-primary bg-primary/10' : 'border-gray-300'
          }`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          {image ? (
            <div className="space-y-4">
              <canvas ref={canvasRef} className="mx-auto border rounded-lg shadow-sm" />
              <Button onClick={clearImage} variant="outline">Clear Image</Button>
            </div>
          ) : (
            <p className="text-gray-500">Drag and drop an image here</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}