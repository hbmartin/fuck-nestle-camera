import type { DetectRequest, DetectResult, WorkerResponse } from "./protocol"

interface PendingRequest {
  resolve: (result: DetectResult) => void
  reject: (error: Error) => void
}

/**
 * Main-thread handle to the OCR Web Worker. Frames are transferred (not
 * copied) to the worker, and at most one detect request should be in flight
 * at a time — the camera loop awaits each result before capturing the next
 * frame.
 */
export class OcrClient {
  private readonly worker: Worker
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 0
  private ready = false
  readonly readyPromise: Promise<void>

  constructor() {
    this.worker = new Worker(new URL("./ocr-worker.ts", import.meta.url))
    this.readyPromise = new Promise((resolve, reject) => {
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data
        if (message.type === "ready") {
          this.ready = true
          resolve()
          return
        }
        if (message.type === "init-error") {
          reject(new Error(message.message))
          return
        }
        this.settle(message)
      }
      this.worker.onerror = (event) => {
        reject(new Error(event.message || "OCR worker failed to load"))
      }
    })
  }

  get isReady(): boolean {
    return this.ready
  }

  private settle(
    message: Extract<WorkerResponse, { type: "result" | "detect-error" }>,
  ): void {
    const request = this.pending.get(message.id)
    if (!request) {
      return
    }
    this.pending.delete(message.id)
    if (message.type === "result") {
      request.resolve({ blurry: message.blurry, lines: message.lines })
    } else {
      request.reject(new Error(message.message))
    }
  }

  detect(imageData: ImageData): Promise<DetectResult> {
    const id = this.nextId++
    const request: DetectRequest = {
      id,
      type: "detect",
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.data.buffer,
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage(request, [request.pixels])
    })
  }

  dispose(): void {
    this.worker.terminate()
    for (const request of this.pending.values()) {
      request.reject(new Error("OCR client disposed"))
    }
    this.pending.clear()
  }
}
