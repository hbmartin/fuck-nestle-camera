import type { OcrLine, OcrWord } from "@/ocr/protocol"
import { Searcher } from "fast-fuzzy"

/**
 * Minimum fuzzy similarity for a match to count. The ocrs bindings do not
 * expose per-word recognition confidence, so a strict match score plus the
 * word-plausibility filter below act as the confidence gate.
 */
const FUZZY_THRESHOLD = 0.85
/**
 * Brands whose name is this short ("Ski", "TOP", "Joe", …) collide with
 * everyday words under fuzzy matching, so they must match a recognized word
 * exactly instead.
 */
const SHORT_BRAND_MAX_LENGTH = 4
/** Minimum length for a recognized word to be considered at all. */
const MIN_WORD_LENGTH = 2
/** Minimum fraction of letters/digits for a word to be considered real text. */
const MIN_ALPHANUMERIC_RATIO = 0.6
/** Longest run of consecutive words matched against multi-word brand names. */
const MAX_WINDOW_WORDS = 4

export type Rect = [number, number, number, number]

export interface BrandMatch {
  brand: string
  score: number
  /** Text the OCR engine actually saw. */
  sourceText: string
  rect: Rect
}

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Cheap plausibility filter for OCR output: drops fragments that are mostly
 * punctuation or stray marks, which the engine emits from noisy frames.
 */
function isPlausibleWord(text: string): boolean {
  if (text.length < MIN_WORD_LENGTH) {
    return false
  }
  const alphanumeric = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
  return alphanumeric / text.length >= MIN_ALPHANUMERIC_RATIO
}

function unionRect(words: OcrWord[]): Rect {
  let [left, top, right, bottom] = words[0].rect
  for (const word of words) {
    left = Math.min(left, word.rect[0])
    top = Math.min(top, word.rect[1])
    right = Math.max(right, word.rect[2])
    bottom = Math.max(bottom, word.rect[3])
  }
  return [left, top, right, bottom]
}

export class BrandMatcher {
  private readonly searcher: Searcher<
    string,
    { returnMatchData: true; threshold: number }
  >
  private readonly exactBrands = new Map<string, string>()
  private readonly fuzzyBrands = new Map<string, string>()
  private readonly maxBrandWords: number

  constructor(brands: string[]) {
    const fuzzyBrands: string[] = []
    let maxBrandWords = 1
    for (const brand of brands) {
      const normalized = normalizeText(brand)
      if (normalized.length === 0) {
        continue
      }
      maxBrandWords = Math.max(maxBrandWords, normalized.split(" ").length)
      if (normalized.length <= SHORT_BRAND_MAX_LENGTH) {
        this.exactBrands.set(normalized, brand)
      } else {
        fuzzyBrands.push(normalized)
        this.fuzzyBrands.set(normalized, brand)
      }
    }
    this.maxBrandWords = Math.min(maxBrandWords, MAX_WINDOW_WORDS)
    this.searcher = new Searcher(fuzzyBrands, {
      returnMatchData: true,
      threshold: FUZZY_THRESHOLD,
      // Compare the whole candidate string, not the best substring:
      // otherwise generic words score 1.0 against any multi-word brand
      // containing them ("water" → "Water Line").
      useSellers: false,
    })
  }

  private matchText(
    text: string,
    rect: Rect,
    results: Map<string, BrandMatch>,
  ) {
    const normalized = normalizeText(text)
    const exact = this.exactBrands.get(normalized)
    if (exact) {
      this.record(results, { brand: exact, score: 1, sourceText: text, rect })
    }
    for (const match of this.searcher.search(normalized)) {
      this.record(results, {
        brand: this.fuzzyBrands.get(match.item) ?? match.item,
        score: match.score,
        sourceText: text,
        rect,
      })
    }
  }

  private record(results: Map<string, BrandMatch>, match: BrandMatch) {
    const existing = results.get(match.brand)
    if (!existing || match.score > existing.score) {
      results.set(match.brand, match)
    }
  }

  /**
   * Matches every plausible recognized word and every window of up to
   * MAX_WINDOW_WORDS consecutive words (so multi-word brands like "Kit Kat"
   * are found inside longer lines), returning the best match per brand.
   */
  matchLines(lines: OcrLine[]): BrandMatch[] {
    const results = new Map<string, BrandMatch>()
    for (const line of lines) {
      const plausibleWords = line.words.filter((word) =>
        isPlausibleWord(word.text),
      )
      for (let size = 1; size <= this.maxBrandWords; size++) {
        for (let start = 0; start + size <= plausibleWords.length; start++) {
          const window = plausibleWords.slice(start, start + size)
          this.matchText(
            window.map((word) => word.text).join(" "),
            unionRect(window),
            results,
          )
        }
      }
    }
    return Array.from(results.values())
  }
}
