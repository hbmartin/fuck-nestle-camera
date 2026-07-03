import type { BrandMatch } from "./brand-matcher"

/** Number of recent processed frames considered when voting. */
const VOTE_WINDOW = 3
/** A brand must appear in at least this many frames of the window. */
const VOTE_MIN_HITS = 2
/** How long a confirmed brand stays on screen after its last sighting. */
const DISPLAY_TTL_MS = 2000

export interface ConfirmedBrand extends BrandMatch {
  lastSeenAt: number
}

/**
 * Multi-frame voting over OCR matches: a brand is only reported after being
 * seen in at least VOTE_MIN_HITS of the last VOTE_WINDOW processed frames,
 * which suppresses single-frame OCR hallucinations, and it lingers for
 * DISPLAY_TTL_MS after its last sighting, which suppresses flicker.
 */
export class TemporalVoter {
  private readonly frames: Set<string>[] = []
  private readonly lastMatch = new Map<string, ConfirmedBrand>()
  private readonly confirmedUntil = new Map<string, number>()

  addFrame(matches: BrandMatch[], now: number): ConfirmedBrand[] {
    this.frames.push(new Set(matches.map((match) => match.brand)))
    if (this.frames.length > VOTE_WINDOW) {
      this.frames.shift()
    }
    for (const match of matches) {
      this.lastMatch.set(match.brand, { ...match, lastSeenAt: now })
    }
    this.promoteWinners(matches, now)
    this.evictExpired(now)
    return Array.from(this.confirmedUntil.keys())
      .map((brand) => this.lastMatch.get(brand))
      .filter((match): match is ConfirmedBrand => match !== undefined)
      .sort((a, b) => b.score - a.score)
  }

  reset(): void {
    this.frames.length = 0
    this.lastMatch.clear()
    this.confirmedUntil.clear()
  }

  private promoteWinners(matches: BrandMatch[], now: number): void {
    const currentFrame = new Set(matches.map((match) => match.brand))
    const hits = new Map<string, number>()
    for (const frame of this.frames) {
      for (const brand of frame) {
        hits.set(brand, (hits.get(brand) ?? 0) + 1)
      }
    }
    for (const [brand, count] of hits) {
      if (count >= VOTE_MIN_HITS && currentFrame.has(brand)) {
        this.confirmedUntil.set(brand, now + DISPLAY_TTL_MS)
      }
    }
  }

  private evictExpired(now: number): void {
    for (const [brand, until] of this.confirmedUntil) {
      if (until < now) {
        this.confirmedUntil.delete(brand)
        this.lastMatch.delete(brand)
      }
    }
  }
}
