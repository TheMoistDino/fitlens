import type { FormCue } from '../types';

/**
 * Multimodal cue output: haptic (Vibration API, Android) + a short audio tone, optionally spoken.
 * Every channel is feature-detected and wrapped — a missing API just means that channel is silent.
 * Rate-limited per cue code so a sustained fault doesn't buzz every frame.
 */
const COOLDOWN_MS = 3000;

export class CueDispatcher {
  private lastFired = new Map<string, number>();
  private audio: AudioContext | null = null;
  speak = false;
  muted = false;

  fire(cue: FormCue, now = performance.now()): boolean {
    const last = this.lastFired.get(cue.code) ?? -Infinity;
    if (now - last < COOLDOWN_MS) return false;
    this.lastFired.set(cue.code, now);
    if (this.muted) return true;

    this.vibrate(cue.severity === 'critical' ? [80, 50, 80, 50, 80] : cue.severity === 'warn' ? [60, 40, 60] : [30]);
    this.tone(cue.severity === 'critical' ? 220 : cue.severity === 'warn' ? 330 : 660);
    if (this.speak) this.say(cue.message);
    return true;
  }

  /** Positive feedback on each rep: a short high blip. */
  repBlip(): void {
    if (!this.muted) this.tone(880, 0.06);
  }

  /** Browsers only allow audio after a user gesture — call this from a click handler. */
  unlock(): void {
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    } catch {
      this.audio = null;
    }
  }

  dispose(): void {
    void this.audio?.close().catch(() => {});
    this.audio = null;
  }

  private vibrate(pattern: number[]): void {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported (iOS Safari) */
    }
  }

  private tone(freq: number, seconds = 0.12): void {
    const ctx = this.audio;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seconds);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + seconds);
    } catch {
      /* ignore */
    }
  }

  private say(text: string): void {
    try {
      if (!('speechSynthesis' in window) || speechSynthesis.speaking) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.1;
      speechSynthesis.speak(u);
    } catch {
      /* ignore */
    }
  }
}
