import type { SubjectLock } from "./face";

export interface Photo {
  id: string;
  img: HTMLImageElement;
  url: string; // object URL (revoked on purge)
  label: string; // year / caption typed by the user
  lock: SubjectLock;
}

export interface RenderOptions {
  width: number;
  height: number;
  /** seconds each photo holds fully visible */
  hold: number;
  /** crossfade seconds between photos */
  fade: number;
  /** subject (head) height as a fraction of output height */
  faceFrac: number;
}

interface Placed {
  photo: Photo;
  /** scale that maps source px -> output px so the head height hits target */
  scale: number;
  /** blurred cover backdrop, pre-rendered at output size */
  backdrop: HTMLCanvasElement;
  tStart: number; // fully-visible start
  tEnd: number;   // fully-visible end (fade to next begins here)
}

/** The fixed anchor every subject is pinned to: horizontal center,
 *  eyes slightly above middle. Shared by layout math and drawing —
 *  they must agree or faces settle off-anchor. */
const ANCHOR_X = 0.5;
const ANCHOR_Y = 0.42;

export class TimelineRenderer {
  private placed: Placed[] = [];
  private grain: HTMLCanvasElement;
  opts: RenderOptions;
  duration = 0;

  constructor(photos: Photo[], opts: RenderOptions) {
    this.opts = opts;
    this.grain = makeGrainTile();
    this.layout(photos);
  }

  /** (Re)compute placements — call after reorder, aspect or slider change. */
  layout(photos: Photo[]) {
    const { width: W, height: H, hold, fade, faceFrac } = this.opts;
    this.placed = photos.map((photo, i) => {
      const { img, lock } = photo;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const cover = Math.max(W / iw, H / ih);
      const contain = Math.min(W / iw, H / ih);
      // Scale so the head height equals faceFrac of the frame…
      let scale = (faceFrac * H) / (lock.fh * ih);
      // …bounded: never below a full "contain" fit (photo floating tiny
      // in blur = reads as black bars) nor past a destructive crop.
      // No face to pin → cover-fill the frame like any scenery shot.
      if (lock.locked) {
        scale = Math.min(Math.max(scale, contain), cover * 2.6);
        // An off-center face reaches the anchor only when the photo has
        // slack to slide without opening a gap. These are the exact
        // scales at which each axis gains that slack (the y split is
        // asymmetric because the anchor sits at 0.42H, not center)…
        const needX = (W / iw) * Math.max(ANCHOR_X / lock.fx, (1 - ANCHOR_X) / (1 - lock.fx));
        const needY = (H / ih) * Math.max(ANCHOR_Y / lock.fy, (1 - ANCHOR_Y) / (1 - lock.fy));
        // …zoom toward them, capped at 1.35× so heads stay near the
        // target size. A partial boost only helps once the photo covers
        // the axis (below coverage it just enlarges a pillarboxed photo
        // and pushes the face away), so gate each axis on coverage.
        const budget = scale * 1.35;
        for (const [need, dim, frame] of [[needX, iw, W], [needY, ih, H]] as const) {
          const boosted = Math.min(need, budget);
          if (boosted > scale && dim * boosted >= frame) scale = boosted;
        }
        scale = Math.min(scale, cover * 2.6);
        // Group shots: whatever head size wants, never zoom so far that
        // someone's face leaves the anchored viewport.
        if (lock.spread) {
          const { x0, y0, x1, y1 } = lock.spread;
          const caps = [
            (ANCHOR_X * W) / ((lock.fx - x0) * iw),
            ((1 - ANCHOR_X) * W) / ((x1 - lock.fx) * iw),
            (ANCHOR_Y * H) / ((lock.fy - y0) * ih),
            ((1 - ANCHOR_Y) * H) / ((y1 - lock.fy) * ih),
          ].filter((c) => Number.isFinite(c) && c > 0);
          if (caps.length) scale = Math.max(contain, Math.min(scale, ...caps));
        }
      } else {
        scale = cover;
      }
      const tStart = i * (hold + fade);
      return {
        photo,
        scale,
        backdrop: makeBackdrop(img, W, H),
        tStart,
        tEnd: tStart + hold,
      };
    });
    const n = this.placed.length;
    this.duration = n > 0 ? n * hold + Math.max(0, n - 1) * fade : 0;
  }

  /** Which photo index dominates at time t (for HUD/scrub sync). */
  indexAt(t: number): number {
    const { hold, fade } = this.opts;
    return Math.min(
      this.placed.length - 1,
      Math.max(0, Math.floor(t / (hold + fade)))
    );
  }

  /** Deterministic: same t always produces the same pixels. */
  drawFrame(ctx: CanvasRenderingContext2D, t: number) {
    const { width: W, height: H, hold, fade } = this.opts;
    const n = this.placed.length;
    if (!n) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H); return; }

    t = Math.min(Math.max(t, 0), Math.max(this.duration - 1e-4, 0));
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const i = this.indexAt(t);
    const cur = this.placed[i];
    const next = this.placed[i + 1];
    const local = t - cur.tStart;
    // 0..1 progress through this photo's full lifetime (hold + fade)
    const life = local / (hold + (next ? fade : 0.0001));
    // crossfade amount into the next photo
    const mix = next && local > hold ? easeInOut((local - hold) / fade) : 0;

    this.drawPhoto(ctx, cur, 1, life, i);
    if (next && mix > 0) {
      // next photo begins its life during the fade
      const nextLife = (local - hold) / (hold + fade) * 0.35;
      ctx.globalAlpha = mix;
      this.drawPhoto(ctx, next, mix, nextLife, i + 1);
      ctx.globalAlpha = 1;
    }

    this.drawGrade(ctx);
    this.drawGrain(ctx, t);
    this.drawLowerThird(ctx, t, i, mix, next ? i + 1 : i);
    this.drawProgress(ctx, t);
  }

  /** One photo layer: blurred backdrop + subject pinned to the anchor. */
  private drawPhoto(
    ctx: CanvasRenderingContext2D,
    p: Placed,
    _alpha: number,
    life: number,
    seed: number
  ) {
    const { width: W, height: H } = this.opts;
    const { img, lock } = p.photo;

    // Anchor: identical for every photo, which is what makes the
    // subject feel bolted in place.
    const ax = W * ANCHOR_X;
    const ay = H * ANCHOR_Y;

    // Slow push-in, scaling about the settled pin point (below) so the
    // face never drifts even when full-bleed limits how close to the
    // anchor it could get.
    const zoom = 1 + 0.06 * easeInOut(clamp01(life));
    // Backdrop drifts a touch faster => parallax: world moves, person doesn't.
    const bgZoom = 1 + 0.11 * easeInOut(clamp01(life));
    const bgDrift = (seed % 2 === 0 ? 1 : -1) * 14 * easeInOut(clamp01(life));

    // backdrop (already cover-sized)
    ctx.save();
    ctx.translate(W / 2 + bgDrift, H / 2);
    ctx.scale(bgZoom, bgZoom);
    ctx.drawImage(p.backdrop, -W / 2, -H / 2, W, H);
    ctx.restore();

    // subject layer — settle placement at base scale: pin the face to
    // the anchor, then per axis: if the photo covers the frame, slide
    // only as far as full bleed allows (no gaps); if it can't (aspect
    // mismatch), center that axis over the blurred backdrop.
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const w0 = iw * p.scale, h0 = ih * p.scale;
    let px = ax - lock.fx * w0;
    let py = ay - lock.fy * h0;
    px = w0 >= W ? Math.min(0, Math.max(W - w0, px)) : (W - w0) / 2;
    py = h0 >= H ? Math.min(0, Math.max(H - h0, py)) : (H - h0) / 2;
    // Zoom about the settled pin point — wherever the face landed, it
    // stays exactly there for the photo's whole life. (Re-clamping at
    // the zoomed size instead would slide the subject as zoom grows.)
    const pinX = px + lock.fx * w0;
    const pinY = py + lock.fy * h0;
    const dw = w0 * zoom, dh = h0 * zoom;
    const dx = pinX - lock.fx * dw;
    const dy = pinY - lock.fy * dh;
    ctx.save();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  /** Cinematic grade: vignette + subtle warm lift. */
  private drawGrade(ctx: CanvasRenderingContext2D) {
    const { width: W, height: H } = this.opts;
    const r = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(30,24,18,0.34)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  /** Deterministic film grain: tile offset derived from the frame index. */
  private drawGrain(ctx: CanvasRenderingContext2D, t: number) {
    const { width: W, height: H } = this.opts;
    const frame = Math.floor(t * 30);
    const ox = (hash(frame) % 128);
    const oy = (hash(frame * 7 + 3) % 128);
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = "overlay";
    for (let y = -oy; y < H; y += 256) {
      for (let x = -ox; x < W; x += 256) {
        ctx.drawImage(this.grain, x, y, 256, 256);
      }
    }
    ctx.restore();
  }

  /** Year / caption lower-third with a typewriter-style reveal. */
  private drawLowerThird(
    ctx: CanvasRenderingContext2D,
    t: number,
    i: number,
    mix: number,
    nextI: number
  ) {
    const drawLabel = (idx: number, alpha: number) => {
      const label = this.placed[idx]?.photo.label.trim();
      if (!label || alpha <= 0.01) return;
      const { width: W, height: H } = this.opts;
      const base = Math.round(H * 0.052);
      const pad = Math.round(H * 0.07);
      const local = t - this.placed[idx].tStart + (idx === i ? 0 : this.opts.fade);
      const reveal = clamp01(local / 0.5);
      const chars = Math.max(1, Math.ceil(label.length * reveal));
      const text = label.slice(0, chars);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `600 ${Math.round(base * 1.35)}px "Caveat", "Segoe Script", cursive`;
      ctx.textBaseline = "alphabetic";
      const tw = ctx.measureText(label).width;
      const x = W / 2 - tw / 2;
      const y = H - pad;
      // amber rule
      ctx.fillStyle = "rgba(233,151,155,0.95)";
      ctx.fillRect(x, y + base * 0.35, tw * reveal, Math.max(2, H * 0.004));
      // text w/ shadow for contrast on any photo
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = base * 0.35;
      ctx.fillStyle = "#FFF9EF";
      ctx.fillText(text, x, y);
      // frame counter, bottom right
      ctx.shadowBlur = 0;
      ctx.font = `500 ${Math.round(base * 0.42)}px "IBM Plex Mono", monospace`;
      ctx.fillStyle = "rgba(244,241,232,0.55)";
      const counter = `${String(idx + 1).padStart(2, "0")} / ${String(this.placed.length).padStart(2, "0")}`;
      ctx.fillText(counter, W - pad - ctx.measureText(counter).width, H - pad * 0.55);
      ctx.restore();
    };
    drawLabel(i, 1 - mix);
    if (mix > 0) drawLabel(nextI, mix);
  }

  /** Thin timeline bar with a tick per photo. */
  private drawProgress(ctx: CanvasRenderingContext2D, t: number) {
    const { width: W, height: H } = this.opts;
    const n = this.placed.length;
    const y = H - Math.max(4, Math.round(H * 0.008));
    const hgt = Math.max(3, Math.round(H * 0.005));
    ctx.save();
    ctx.fillStyle = "rgba(244,241,232,0.18)";
    ctx.fillRect(0, y, W, hgt);
    ctx.fillStyle = "rgba(233,151,155,0.95)";
    ctx.fillRect(0, y, W * (t / Math.max(this.duration, 0.001)), hgt);
    ctx.fillStyle = "rgba(244,241,232,0.5)";
    for (let k = 1; k < n; k++) {
      const x = (k * (this.opts.hold + this.opts.fade) / this.duration) * W;
      ctx.fillRect(x - 1, y - 2, 2, hgt + 4);
    }
    ctx.restore();
  }
}

/* ── helpers ─────────────────────────────────────────────── */

function makeBackdrop(img: HTMLImageElement, W: number, H: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const cover = Math.max(W / iw, H / ih) * 1.12; // overscan hides drift edges
  const dw = iw * cover, dh = ih * cover;
  ctx.filter = "blur(28px) brightness(0.7) saturate(1.1)";
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.filter = "none";
  return c;
}

function makeGrainTile(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 256;
  const ctx = c.getContext("2d")!;
  const d = ctx.createImageData(256, 256);
  let s = 1234567;
  for (let i = 0; i < d.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const v = s % 256;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
function hash(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}
