export interface SubjectLock {
  /** face center, normalized 0..1 of source image */
  fx: number;
  fy: number;
  /** face height, normalized 0..1 of source image height */
  fh: number;
  /** group shots: normalized bbox around every head — the renderer
   *  caps zoom so none of them leaves the frame */
  spread?: { x0: number; y0: number; x1: number; y1: number };
  /** true when a real face was found (vs. center fallback) */
  locked: boolean;
}

type FaceApi = typeof import("@vladmandic/face-api");
let loading: Promise<FaceApi> | null = null;

/** Lazy-load the detection library + tiny detector weights (~190 KB). */
export function loadFaceModel(): Promise<FaceApi> {
  if (!loading) {
    loading = import("@vladmandic/face-api").then(async (faceapi) => {
      await faceapi.nets.tinyFaceDetector.loadFromUri(
        `${import.meta.env.BASE_URL}models`
      );
      return faceapi;
    });
  }
  return loading;
}

const FALLBACK: Omit<SubjectLock, "locked"> = { fx: 0.5, fy: 0.42, fh: 0.3 };

/**
 * Find the subject in an image. Faces are scored by size × centrality;
 * a clearly dominant face becomes the anchor, otherwise (group shot)
 * the area-weighted centroid of all faces does. Falls back to a
 * rule-of-thirds center when no face is found so the film still works
 * with pets, landscapes, etc.
 */
export async function detectSubject(img: HTMLImageElement): Promise<SubjectLock> {
  try {
    const faceapi = await withTimeout(loadFaceModel(), 15000);
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 512,
      scoreThreshold: 0.35,
    });
    const detections = await withTimeout(Promise.resolve(faceapi.detectAllFaces(img, options)), 10000);
    if (!detections.length) return { ...FALLBACK, locked: false };

    const iw = img.naturalWidth, ih = img.naturalHeight;
    // Subject = big AND near the photo's center. Pure "largest face"
    // grabbed whoever leaned closest to the camera in group shots.
    const scored = detections
      .map((d) => {
        const cx = (d.box.x + d.box.width / 2) / iw;
        const cy = (d.box.y + d.box.height / 2) / ih;
        return { box: d.box, score: d.box.area * (1 - Math.hypot(cx - 0.5, cy - 0.5)) };
      })
      .sort((a, b) => b.score - a.score);

    const subject = scored[0].box;
    const rivalArea = Math.max(0, ...scored.slice(1).map((s) => s.box.area));
    // Detector boxes hug the face; nudge up + inflate so the anchor sits
    // between the eyes and scale reflects the whole head.
    let fx: number, fy: number, fh: number;
    let spread: SubjectLock["spread"];
    if (subject.area >= 1.5 * rivalArea) {
      // One clearly dominant face — single-subject anchor.
      fx = (subject.x + subject.width / 2) / iw;
      fy = (subject.y + subject.height * 0.44) / ih;
      fh = (subject.height * 1.35) / ih;
    } else {
      // Similar-sized faces = group shot. Anchor the area-weighted
      // centroid so the whole group centers instead of one member, and
      // record the group's extent so the renderer never zooms a face
      // out of the frame while chasing head size on the tallest one.
      let wsum = 0, sx = 0, sy = 0, tallest = 0;
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      for (const { box } of scored) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        sx += box.area * cx;
        sy += box.area * (box.y + box.height * 0.44);
        wsum += box.area;
        tallest = Math.max(tallest, box.height);
        const hw = box.width * 0.675, hh = box.height * 0.675; // head-inflated
        x0 = Math.min(x0, (cx - hw) / iw);
        x1 = Math.max(x1, (cx + hw) / iw);
        y0 = Math.min(y0, (cy - hh) / ih);
        y1 = Math.max(y1, (cy + hh) / ih);
      }
      fx = sx / wsum / iw;
      fy = sy / wsum / ih;
      fh = (tallest * 1.35) / ih;
      spread = { x0: clamp01(x0), y0: clamp01(y0), x1: clamp01(x1), y1: clamp01(y1) };
    }
    return {
      fx: clamp01(fx),
      fy: clamp01(fy),
      fh: Math.min(Math.max(fh, 0.05), 0.95),
      spread,
      locked: true,
    };
  } catch (err) {
    console.warn("Face detection unavailable, using center fallback", err);
    return { ...FALLBACK, locked: false };
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("detection timeout")), ms)),
  ]);
}
