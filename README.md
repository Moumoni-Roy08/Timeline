# 📷 Timeline

Turn **10–20 photos into a timeline film** where the person stays bolted to the center of the frame while the world changes around them. A camera-themed, fully client-side web app.

## Why it's private by design

- **Zero uploads.** There is no backend. Photos are read as in-memory object URLs, face detection runs on-device (TensorFlow.js tiny face detector, ~190 KB of local weights), and the video is encoded in your browser with WebCodecs.
- **15-minute self-destruct.** A visible countdown starts when a film is generated (or when photos are loaded). At 00:00 every object URL is revoked, all state is wiped, and the app resets. Closing the tab wipes everything instantly anyway — nothing is ever written to disk, localStorage, or a server.

## How the subject stays centered

1. Each photo runs through the tiny face detector; the largest face wins.
2. The head is normalized to a fixed **anchor point** (50% x, 42% y) and a fixed **head height** (adjustable 16–38% of frame).
3. Every photo is scaled and translated so its face lands exactly on that anchor — a face on the far left of one photo and far right of the next both render at dead center.
4. A blurred, darkened copy of the photo fills the frame behind the subject, and drifts/zooms slightly faster than the subject layer — parallax that sells "only the background is changing."
5. Photos with no detectable face (pets, landscapes) fall back to a rule-of-thirds center and get a `NO FACE · CENTERED` badge in the film strip.

## Features

- 🖼 **Hand-drawn watercolor backdrop** (`public/bg.svg`, regenerate with `python3 gen_bg.py`): blossom branches with leaf shadows, a blue shuttered window, tulip pots on a brick path — calm cream center so content stays readable; cards are lightly frosted so the scene glows through
- 🌷 **3D tulip-pot mascot** (three.js, lazy-loaded) on the landing screen and floating over the editor — modeled after the watercolor reference art; pauses offscreen and respects reduced motion

- 🎞 Crossfade timeline with per-photo hold time, film grain, vignette, progress ticks
- 🔤 Type a year/caption under any frame — typewriter-reveal lower third in the film
- ↕️ Drag frames to reorder, ✕ to remove, add more anytime (max 20)
- 📐 16:9 / 9:16 / 1:1 output (1080p), chosen in-app
- ⬇️ **MP4 download** via WebCodecs (H.264 where available → VP9-in-MP4 → WebM as last-resort fallback for old browsers)
- ⭐ GitHub star button in the header
- ♿ Keyboard-scrubbable timeline, `prefers-reduced-motion` respected

## Run it

```bash
npm install
npm run dev      # local dev at http://localhost:5173
npm run build    # static site in dist/ — deploy to Vercel/Netlify/Pages/anywhere
npm run preview
```

No server-side code, so any static host works.

## Configure

Everything lives in [`src/config.ts`](src/config.ts):

```ts
export const GITHUB_REPO_URL = "https://github.com/YOUR_USERNAME/timeline"; // ← point the ⭐ button at your repo
export const PURGE_MS = 15 * 60 * 1000; // session lifetime
export const FPS = 30;
```

## Smoke test (headless)

```bash
npm run smoke              # uses Chrome at /opt/google/chrome/chrome
CHROME_PATH=/path/to/chrome npm run smoke
```

Loads the built app, uploads synthetic photos, verifies the canvas renders, switches aspect ratio, exports a film, and checks the blob.

## Browser support

| Capability | Chrome / Edge | Firefox | Safari 16.4+ |
|---|---|---|---|
| Preview + face detection | ✅ | ✅ | ✅ |
| MP4 export (WebCodecs) | ✅ | ✅ (recent) | ✅ |
| WebM fallback | ✅ | ✅ | ⚠️ limited |

## Stack

Vite + TypeScript, no framework. [`three`](https://threejs.org) for the tulip mascot, [`@vladmandic/face-api`](https://github.com/vladmandic/face-api) (lazy-loaded), [`mp4-muxer`](https://github.com/Vanilagy/mp4-muxer), Canvas 2D renderer with a deterministic `drawFrame(t)` so preview and export are pixel-identical.

## Contributing

This is **v1** — open source and open for contributions. Issues and PRs welcome: bug fixes, new aspect ratios, additional export formats, accessibility improvements, whatever you've got.

1. Fork the repo, create a branch
2. `npm install`, make your change
3. `npm run smoke` to sanity-check the export pipeline still works
4. Open a PR describing what changed and why
