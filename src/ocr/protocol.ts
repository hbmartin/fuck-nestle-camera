export interface OcrWord {
  text: string
  /** Axis-aligned bounding box as [left, top, right, bottom]. */
  rect: [number, number, number, number]
}

export interface OcrLine {
  text: string
  words: OcrWord[]
}

export interface DetectRequest {
  id: number
  type: "detect"
  width: number
  height: number
  /** RGBA pixel data, transferred to the worker. */
  pixels: ArrayBuffer
}

export interface DetectResult {
  /** True when the frame was too blurry to be worth running OCR on. */
  blurry: boolean
  lines: OcrLine[]
}

export type WorkerResponse =
  | { type: "ready" }
  | { type: "init-error"; message: string }
  | { type: "result"; id: number; blurry: boolean; lines: OcrLine[] }
  | { type: "detect-error"; id: number; message: string }
