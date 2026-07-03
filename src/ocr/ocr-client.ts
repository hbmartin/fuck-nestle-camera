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
  private disposed = false
  private readySettled = false
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  readonly readyPromise: Promise<void>

  constructor() {
    this.worker = new Worker(new URL("./ocr-worker.ts", import.meta.url), {
      type: "module",
    })
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (this.disposed) {
          return
        }
        const message = event.data
        if (message.type === "ready") {
          this.settleReady()
          return
        }
        if (message.type === "init-error") {
          this.failWorker(new Error(message.message))
          return
        }
        this.settle(message)
      }
    })
    this.worker.onerror = (event) => {
      if (this.disposed) {
        return
      }
      this.failWorker(new Error(event.message || "OCR worker failed"))
    }
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

  private settleReady(): void {
    if (this.readySettled) {
      return
    }
    this.ready = true
    this.readySettled = true
    this.resolveReady?.()
    this.resolveReady = null
    this.rejectReady = null
  }

  private rejectReadiness(error: Error): void {
    if (this.readySettled) {
      return
    }
    this.readySettled = true
    this.rejectReady?.(error)
    this.resolveReady = null
    this.rejectReady = null
  }

  private failPending(error: Error): void {
    for (const request of this.pending.values()) {
      request.reject(error)
    }
    this.pending.clear()
  }

  private failWorker(error: Error): void {
    this.ready = false
    this.disposed = true
    this.rejectReadiness(error)
    this.failPending(error)
    this.worker.terminate()
  }

  detect(imageData: ImageData): Promise<DetectResult> {
    if (this.disposed) {
      return Promise.reject(new Error("OCR client is disposed"))
    }
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
      try {
        this.worker.postMessage(request, [request.pixels])
      } catch (error) {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.worker.terminate()
    const error = new Error("OCR client disposed")
    this.rejectReadiness(error)
    this.failPending(error)
  }
}
