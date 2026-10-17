import type { WeightReading, WeightUnit } from '../types';

/**
 * Turns raw OCR text from a weight-stack crop into a plausible load, then requires the same value
 * on N consecutive frames before locking. Pure functions only — no DOM, fully unit-tested.
 */

export const MIN_OCR_CONFIDENCE = 40;
export const LOCK_FRAMES = 3;

const RANGE: Record<WeightUnit, [number, number]> = { lb: [5, 700], kg: [2.5, 320] };

/** Characters Tesseract commonly confuses with digits on stamped/painted plates. */
const CONFUSABLES: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', '!': '1', Z: '2', S: '5', B: '8', T: '7', G: '6' };

export function detectUnit(text: string): WeightUnit | null {
  const t = text.toUpperCase();
  if (/K\s*G/.test(t)) return 'kg';
  if (/L\s*B|#/.test(t)) return 'lb';
  return null;
}

/** Strip unit tokens first (so the L/B/G in "LBS"/"KG" aren't mapped to digits), then fix confusables. */
export function normalizeDigits(text: string): string {
  return text
    .toUpperCase()
    .replace(/K\s*GS?|L\s*BS?|#/g, ' ')
    .replace(/[OQDIL|!ZSBTG]/g, (ch) => CONFUSABLES[ch] ?? ch)
    .replace(/,/g, '.');
}

export function isPlausibleLoad(value: number, unit: WeightUnit): boolean {
  const [min, max] = RANGE[unit];
  if (!(value >= min && value <= max)) return false;
  // Stacks/plates come in 2.5 increments (lb plates: 2.5/5/10…, kg: 1.25 pairs → 2.5 totals).
  return Math.abs(value / 2.5 - Math.round(value / 2.5)) < 1e-6;
}

export function parseWeightText(rawText: string, confidence: number, defaultUnit: WeightUnit = 'lb'): WeightReading | null {
  if (confidence < MIN_OCR_CONFIDENCE || !rawText.trim()) return null;
  const unit = detectUnit(rawText) ?? defaultUnit;
  const matches = normalizeDigits(rawText).match(/\d+(?:\.\d+)?/g) ?? [];

  // Prefer the longest plausible number (the stack label, not a stray "1" from a pin hole).
  const candidates = matches
    .map((m) => ({ m, v: Number(m) }))
    .filter(({ v }) => isPlausibleLoad(v, unit))
    .sort((a, b) => b.m.length - a.m.length || b.v - a.v);

  const best = candidates[0];
  return best ? { value: best.v, unit, confidence } : null;
}

export interface SmootherState {
  candidate: WeightReading | null;
  streak: number;
  locked: WeightReading | null;
}

/**
 * Temporal debounce: a value locks only after LOCK_FRAMES identical consecutive readings.
 * An unreadable frame (null) breaks the streak — glare flicker can't sneak a value through.
 */
export class WeightLockSmoother {
  private state: SmootherState = { candidate: null, streak: 0, locked: null };

  constructor(private readonly required = LOCK_FRAMES) {}

  get current(): SmootherState {
    return this.state;
  }

  push(reading: WeightReading | null): SmootherState {
    if (this.state.locked) return this.state;
    if (!reading) {
      this.state = { candidate: null, streak: 0, locked: null };
      return this.state;
    }
    const prev = this.state.candidate;
    const same = prev !== null && prev.value === reading.value && prev.unit === reading.unit;
    const streak = same ? this.state.streak + 1 : 1;
    this.state = { candidate: reading, streak, locked: streak >= this.required ? reading : null };
    return this.state;
  }

  reset(): void {
    this.state = { candidate: null, streak: 0, locked: null };
  }
}

/** Manual adjustment step for the +/- buttons. */
export const weightStep = (unit: WeightUnit) => (unit === 'kg' ? 2.5 : 5);
