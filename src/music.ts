/**
 * Tiny generative ambient score — no audio files, no licensing, nothing
 * leaves the device. A warm bass + pad bed with a soft bell melody
 * drifting over a four-chord loop (~19s), fed through a gentle delay for
 * space. Starts on the first user gesture (mobile autoplay policy), and
 * can be muted/unmuted from the speaker button any time.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer = 0;
let muted = false;

/* Fmaj7 → Cmaj7 → Dm7 → B♭maj7 — warm, gently wistful, seamless loop. */
const PROG: { bass: number; pad: number[]; scale: number[] }[] = [
  { bass: 87.31,  pad: [174.61, 220.0, 261.63, 329.63], scale: [349.23, 392.0, 440.0, 523.25, 587.33] },
  { bass: 130.81, pad: [196.0, 246.94, 329.63, 392.0],  scale: [392.0, 440.0, 523.25, 587.33, 659.25] },
  { bass: 146.83, pad: [220.0, 261.63, 349.23, 440.0],  scale: [440.0, 523.25, 587.33, 698.46, 783.99] },
  { bass: 116.54, pad: [233.08, 293.66, 349.23, 440.0], scale: [349.23, 466.16, 523.25, 587.33, 698.46] },
];
const BAR = 4.8;
const LOOP = PROG.length * BAR;

/** deterministic per-step pseudo-random so melody feels composed, not noisy */
function rand(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function bass(at: number, freq: number, bus: AudioNode) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.22, at + 0.5);
  g.gain.setValueAtTime(0.22, at + BAR - 0.8);
  g.gain.linearRampToValueAtTime(0, at + BAR);
  osc.connect(g).connect(bus);
  osc.start(at);
  osc.stop(at + BAR + 0.1);
}

function padVoice(at: number, freq: number, bus: AudioNode) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const det = ctx.createOscillator(); // slight detune for warmth
  det.type = "sine";
  det.frequency.value = freq * 1.004;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.05, at + 1.4);
  g.gain.setValueAtTime(0.05, at + BAR - 1.0);
  g.gain.linearRampToValueAtTime(0, at + BAR + 0.4);
  osc.connect(g);
  det.connect(g).connect(bus);
  osc.start(at); det.start(at);
  osc.stop(at + BAR + 0.5); det.stop(at + BAR + 0.5);
}

/** soft FM bell for the melody */
function bell(at: number, freq: number, bus: AudioNode, vel = 1) {
  if (!ctx) return;
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;
  const modOsc = ctx.createOscillator();
  modOsc.type = "sine";
  modOsc.frequency.value = freq * 2.0;
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(freq * 1.4, at);
  modGain.gain.exponentialRampToValueAtTime(1, at + 1.8);
  modOsc.connect(modGain).connect(carrier.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.18 * vel, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
  carrier.connect(g).connect(bus);
  carrier.start(at); modOsc.start(at);
  carrier.stop(at + 2.7); modOsc.stop(at + 2.7);
}

function scheduleLoop(t0: number, dry: AudioNode, wet: AudioNode) {
  PROG.forEach((step, i) => {
    const t = t0 + i * BAR;
    bass(t, step.bass, dry);
    for (const f of step.pad) padVoice(t, f, dry);
    // 3–4 bell notes per bar, drawn from the chord's scale, sent to delay
    const notes = 3 + Math.floor(rand(i * 7.1) * 2);
    for (let k = 0; k < notes; k++) {
      const seed = i * 13.7 + k * 3.3;
      const pitch = step.scale[Math.floor(rand(seed) * step.scale.length)];
      const oct = rand(seed + 1) > 0.72 ? 2 : 1;
      const when = t + 0.4 + k * (BAR - 0.8) / notes + rand(seed + 2) * 0.25;
      bell(when, pitch * oct, wet, 0.7 + rand(seed + 3) * 0.3);
    }
  });
}

/** Begin playback. Safe to call repeatedly; no-ops if already running. */
export function startMusic(): boolean {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return !muted && ctx.state === "running";
  }
  ctx = new AudioContext();
  // iOS/MIUI can hand back a suspended context even inside a gesture.
  if (ctx.state === "suspended") void ctx.resume();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.7;
  master.connect(ctx.destination);

  // gentle stereo-ish delay for air on the melody
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  const delay = ctx.createDelay(1.0);
  delay.delayTime.value = 0.34;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3200;
  dry.connect(master);
  wet.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(lp).connect(master);
  wet.connect(master);

  let next = ctx.currentTime + 0.15;
  scheduleLoop(next, dry, wet);
  next += LOOP;
  timer = window.setInterval(() => {
    if (!ctx || ctx.state !== "running") return;
    if (ctx.currentTime > next - 2.5) {
      scheduleLoop(next, dry, wet);
      next += LOOP;
    }
  }, 500);
  return !muted;
}

/** Toggle mute. Returns true when audio is now ON (unmuted + running). */
export function toggleMute(): boolean {
  muted = !muted;
  if (!ctx) {
    if (!muted) return startMusic();
    return false;
  }
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.7, ctx.currentTime, 0.05);
  if (!muted && ctx.state === "suspended") void ctx.resume();
  return !muted;
}

export function isMusicOn(): boolean {
  return !!ctx && !muted && ctx.state === "running";
}

/** Full stop + teardown (used by the session purge). */
export function stopMusic() {
  clearInterval(timer);
  timer = 0;
  if (ctx) void ctx.close();
  ctx = null;
  master = null;
}
