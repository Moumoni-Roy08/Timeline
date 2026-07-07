/** ─── Edit me ─────────────────────────────────────────────── */
/** Your repository. The "Star on GitHub" button points here.  */
export const GITHUB_REPO_URL = "https://github.com/Moumoni-Roy08/Timeline";

/** Session lifetime: everything wipes this long after a film is generated
 *  (or after photos are loaded, if no film is ever generated). */
export const PURGE_MS = 15 * 60 * 1000;

/** Export settings */
export const FPS = 30;
export const VIDEO_BITRATE = 9_000_000;

/** Aspect presets (encoder-safe even dimensions) */
export const ASPECTS: Record<string, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
};

/** Photo limits */
export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 20;
