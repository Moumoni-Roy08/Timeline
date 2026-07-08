/**
 * Tiny generative ambient loop — no audio files, no licensing, nothing
 * leaves the device. A soft low pad + sparse plucks cycle through four
 * chords (~16s) and repeat until paused. Starts only on a user tap, so
 * mobile autoplay policies are never an issue.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer = 0;

/** Cmaj7 → Am7 → Fmaj7 → G, calm and loopable. */
const CHORDS: number[][] = [
  [261.63, 329.63, 392.0, 493.88],
  [220.0, 261.63, 329.63, 392.0],
  [174.61, 220.0, 261.63, 349.23],
  [196.0, 246.94, 293.66, 392.0],
];
const BAR = 4; // seconds per chord
const LOOP = CHORDS.length * BAR;

function pad(at: number, freq: number, dur: number) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.16, at + 1.2);
  g.gain.setValueAtTime(0.16, at + dur - 1.2);
  g.gain.linearRampToValueAtTime(0, at + dur);
  osc.connect(g).connect(master);
  osc.start(at);
  osc.stop(at + dur);
}

function pluck(at: number, freq: number) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 2.2);
  osc.connect(lp).connect(g).connect(master);
  osc.start(at);
  osc.stop(at + 2.3);
}

function scheduleLoop(t0: number) {
  CHORDS.forEach((chord, i) => {
    const t = t0 + i * BAR;
    for (const f of chord) pad(t, f / 2, BAR + 0.6); // low, overlapping pad
    pluck(t + 0.0, chord[3]);
    pluck(t + 1.5, chord[1] * 2);
    pluck(t + 2.75, chord[2]);
  });
}

/** Toggle playback. Returns true when music is now playing. */
export function toggleMusic(): boolean {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.75;
    master.connect(ctx.destination);
    let next = ctx.currentTime + 0.05;
    scheduleLoop(next);
    next += LOOP;
    timer = window.setInterval(() => {
      if (!ctx || ctx.state !== "running") return;
      if (ctx.currentTime > next - 2) {
        scheduleLoop(next);
        next += LOOP;
      }
    }, 500);
    return true;
  }
  if (ctx.state === "running") {
    void ctx.suspend();
    return false;
  }
  void ctx.resume();
  return true;
}

/** Full stop + teardown (used by the session purge). */
export function stopMusic() {
  clearInterval(timer);
  timer = 0;
  if (ctx) void ctx.close();
  ctx = null;
  master = null;
}
