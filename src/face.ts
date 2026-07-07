export interface SubjectLock {
  /** face center, normalized 0..1 of source image */
  fx: number;
  fy: number;
  /** face height, normalized 0..1 of source image height */
  fh: number;
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
 * Find the dominant face in an image. Picks the largest detection
 * (the subject), expands the box slightly to head size, and returns
 * a normalized anchor. Falls back to a rule-of-thirds center when
 * no face is found so the film still works with pets, landscapes, etc.
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

    // Largest face = subject
    const best = detections.reduce((a, b) =>
      a.box.area > b.box.area ? a : b
    );
    const { x, y, width, height } = best.box;
    // Detector boxes hug the face; nudge up + inflate so the anchor sits
    // between the eyes and scale reflects the whole head.
    const cx = (x + width / 2) / img.naturalWidth;
    const cy = (y + height * 0.44) / img.naturalHeight;
    const fh = (height * 1.35) / img.naturalHeight;
    return {
      fx: clamp01(cx),
      fy: clamp01(cy),
      fh: Math.min(Math.max(fh, 0.05), 0.95),
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
