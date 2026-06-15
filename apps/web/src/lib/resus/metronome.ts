/**
 * resus/metronome.ts — a Web-Audio CPR metronome (no external deps).
 *
 * Produces a short, percussive "click" at a selectable compression rate
 * (100–120/min) using a look-ahead scheduler: a timer fires every ~25 ms and
 * schedules any clicks that fall inside the next ~100 ms window directly on the
 * AudioContext clock. This keeps timing rock-steady even when the main thread is
 * busy (the usual setInterval-drift problem).
 *
 * Autoplay policy: the AudioContext is created/resumed only from `start()`,
 * which the UI calls from a user gesture (button press). `stop()` suspends the
 * context; `dispose()` closes it entirely (call when leaving the panel).
 *
 * The click is synthesised (oscillator + fast gain envelope) so there is no
 * audio asset to ship.
 */

type BeatCallback = (beatTime: number) => void;

const LOOKAHEAD_MS = 25; // scheduler tick
const SCHEDULE_AHEAD_S = 0.12; // how far ahead to schedule clicks

export class Metronome {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0; // AudioContext time of the next click
  private _bpm: number;
  private _running = false;
  /** fires (on the main thread) slightly before each audible click, for UI. */
  onBeat: BeatCallback | null = null;

  constructor(bpm = 110) {
    this._bpm = bpm;
  }

  get running(): boolean {
    return this._running;
  }

  get bpm(): number {
    return this._bpm;
  }

  /** Change tempo live; takes effect on the next scheduled interval. */
  setBpm(bpm: number): void {
    this._bpm = Math.min(120, Math.max(40, Math.round(bpm)));
  }

  /** Start ticking. MUST be called from a user gesture (autoplay policy). */
  async start(): Promise<void> {
    if (this._running) return;
    if (typeof window === 'undefined') return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // no Web Audio support — silently no-op
    if (!this.ctx) this.ctx = new Ctor();
    // Resuming requires the user-gesture call stack we are (transitively) on.
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this._running = true;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.scheduler(), LOOKAHEAD_MS);
  }

  /** Stop ticking and suspend the context (cheap to start() again). */
  stop(): void {
    this._running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** Fully release the AudioContext. Call when leaving the panel/unmounting. */
  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.onBeat = null;
  }

  private secondsPerBeat(): number {
    return 60 / this._bpm;
  }

  /** Schedule every click that falls within the look-ahead window. */
  private scheduler(): void {
    if (!this.ctx) return;
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_S) {
      this.scheduleClick(this.nextNoteTime);
      this.nextNoteTime += this.secondsPerBeat();
    }
  }

  /** Synthesise one short click at the given AudioContext time. */
  private scheduleClick(time: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1000;
    // Fast percussive envelope: quick attack, ~40 ms decay.
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.4, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);

    // Notify the UI to pulse, aligned to the audible click.
    if (this.onBeat) {
      const delayMs = Math.max(0, (time - this.ctx.currentTime) * 1000);
      const cb = this.onBeat;
      setTimeout(() => cb(time), delayMs);
    }
  }
}
