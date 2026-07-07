import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { FPS, VIDEO_BITRATE } from "./config";

export interface ExportResult {
  blob: Blob;
  ext: "mp4" | "webm";
}

export interface ExportHandle {
  promise: Promise<ExportResult>;
  cancel: () => void;
}

type DrawFn = (ctx: CanvasRenderingContext2D, t: number) => void;

export function supportsMp4(): boolean {
  return typeof (window as any).VideoEncoder === "function";
}

/**
 * Render the timeline frame-by-frame and encode.
 * MP4 (H.264) via WebCodecs when available; VP9/VP8 WebM via
 * MediaRecorder otherwise (Safari < 16.4 etc.).
 */
export function exportFilm(
  draw: DrawFn,
  width: number,
  height: number,
  duration: number,
  onProgress: (frac: number, msg: string) => void
): ExportHandle {
  const ctrl = new AbortController();
  const promise = supportsMp4()
    ? exportMp4(draw, width, height, duration, onProgress, ctrl.signal)
    : exportWebm(draw, width, height, duration, onProgress, ctrl.signal);
  return { promise, cancel: () => ctrl.abort() };
}

async function exportMp4(
  draw: DrawFn, width: number, height: number, duration: number,
  onProgress: (f: number, m: string) => void, signal: AbortSignal
): Promise<ExportResult> {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;

  // Codec preference: H.264 (max compatibility) → VP9-in-MP4 → give up to WebM.
  const candidates: { codecStr: string; muxCodec: "avc" | "vp9" }[] = [
    { codecStr: pickAvcCodec(width, height), muxCodec: "avc" },
    { codecStr: "avc1.42001f", muxCodec: "avc" },
    { codecStr: "vp09.00.10.08", muxCodec: "vp9" },
  ];
  let chosen: { codecStr: string; muxCodec: "avc" | "vp9" } | null = null;
  for (const c of candidates) {
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec: c.codecStr, width, height, bitrate: VIDEO_BITRATE, framerate: FPS,
      });
      if (s.supported) { chosen = c; break; }
    } catch { /* try next */ }
  }
  if (!chosen) {
    return exportWebm(draw, width, height, duration, onProgress, signal);
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: chosen.muxCodec, width, height },
    fastStart: "in-memory",
  });

  // Encoder errors must reject our pipeline, not vanish inside a callback.
  let failPipeline!: (e: unknown) => void;
  const pipelineFailed = new Promise<never>((_, rej) => { failPipeline = rej; });
  pipelineFailed.catch(() => {}); // avoid unhandled-rejection noise

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try { muxer.addVideoChunk(chunk, meta); }
      catch (e) { failPipeline(e); }
    },
    error: (e) => failPipeline(e),
  });
  // Cancel works in EVERY phase: closing the encoder aborts queued work
  // and makes any pending flush() reject immediately.
  const onAbort = () => {
    try { encoder.close(); } catch { /* already closed */ }
    failPipeline(new DOMException("cancelled", "AbortError"));
  };
  if (signal.aborted) onAbort();
  signal.addEventListener("abort", onAbort, { once: true });

  encoder.configure({
    codec: chosen.codecStr, width, height,
    bitrate: VIDEO_BITRATE, framerate: FPS,
  });

  // True backpressure: never let more than a few frames sit in the queue.
  // Progress then tracks actual encoding, and flush() finishes near-instantly.
  const drained = () => new Promise<void>((res) => {
    if (encoder.encodeQueueSize <= 3) return res();
    const poll = setInterval(() => {
      if (encoder.encodeQueueSize <= 3) { cleanup(); res(); }
    }, 40);
    const onDq = () => { if (encoder.encodeQueueSize <= 3) { cleanup(); res(); } };
    const cleanup = () => { clearInterval(poll); encoder.removeEventListener?.("dequeue", onDq); };
    encoder.addEventListener?.("dequeue", onDq);
  });

  const totalFrames = Math.max(1, Math.ceil(duration * FPS));
  const usPerFrame = 1_000_000 / FPS;

  try {
    for (let f = 0; f < totalFrames; f++) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      await Promise.race([drained(), pipelineFailed]);
      draw(ctx, f / FPS);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(f * usPerFrame),
        duration: Math.round(usPerFrame),
      });
      try { encoder.encode(frame, { keyFrame: f % (FPS * 2) === 0 }); }
      finally { frame.close(); }
      if (f % 3 === 0) {
        onProgress((f / totalFrames) * 0.97, `Encoding frame ${f + 1} / ${totalFrames}`);
        await nextTick(); // keep the dialog + cancel button responsive
      }
    }

    onProgress(0.98, "Finalizing MP4…");
    await Promise.race([encoder.flush(), pipelineFailed]);
    if (encoder.state !== "closed") encoder.close();
    muxer.finalize();
    const { buffer } = muxer.target as ArrayBufferTarget;
    onProgress(1, "Done");
    return { blob: new Blob([buffer], { type: "video/mp4" }), ext: "mp4" };
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (encoder.state !== "closed") { try { encoder.close(); } catch { /* noop */ } }
  }
}

function pickAvcCodec(w: number, h: number): string {
  // High profile, level scaled to resolution (4.0 covers 1080p30, 5.1 covers 4K)
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  return mbs > 8192 ? "avc1.640033" : "avc1.640028";
}

async function exportWebm(
  draw: DrawFn, width: number, height: number, duration: number,
  onProgress: (f: number, m: string) => void, signal: AbortSignal
): Promise<ExportResult> {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as any;

  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const done = new Promise<Blob>((resolve, reject) => {
    rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    rec.onerror = () => reject(new Error("Recording failed"));
  });

  rec.start(250);
  const totalFrames = Math.max(1, Math.ceil(duration * FPS));
  const frameMs = 1000 / FPS;
  for (let f = 0; f < totalFrames; f++) {
    if (signal.aborted) { rec.stop(); throw new DOMException("cancelled", "AbortError"); }
    draw(ctx, f / FPS);
    track.requestFrame?.();
    onProgress(f / totalFrames, `Recording frame ${f + 1} / ${totalFrames} (WebM fallback)`);
    await sleep(frameMs); // MediaRecorder is realtime — pace the frames
  }
  rec.stop();
  const blob = await done;
  onProgress(1, "Done");
  return { blob, ext: "webm" };
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
