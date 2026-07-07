import "./style.css";
import { detectSubject, loadFaceModel } from "./face";
import { TimelineRenderer, type Photo } from "./renderer";
import { exportFilm, supportsMp4, type ExportHandle } from "./exporter";
import { ASPECTS, GITHUB_REPO_URL, MAX_PHOTOS, MIN_PHOTOS, PURGE_MS, FPS } from "./config";
import { mountTulip } from "./tulip3d";

/* ── element refs ─────────────────────────────────────────── */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("previewCanvas");
const cctx = canvas.getContext("2d")!;
const dropzone = $("dropzone");
const vfScreen = $("vfScreen");
const afOverlay = $("afOverlay");
const afLabel = $("afLabel");
const fileInput = $<HTMLInputElement>("fileInput");
const deck = $("deck");
const stripWrap = $("filmstripWrap");
const strip = $("filmstrip");
const playBtn = $("playBtn");
const playIco = $("playIco");
const exportBtn = $<HTMLButtonElement>("exportBtn");
const scrub = $("scrub");
const scrubFill = $("scrubFill");
const scrubTicks = $("scrubTicks");
const hudTime = $("hudTime");
const hudCount = $("hudCount");
const hudRes = $("hudRes");
const hudAspect = $("hudAspect");
const hudRec = $("hudRec");
const hudPurge = $("hudPurge");
const purgeTime = $("purgeTime");
const holdRange = $<HTMLInputElement>("holdRange");
const holdOut = $("holdOut");
const faceRange = $<HTMLInputElement>("faceRange");
const faceOut = $("faceOut");
const exportDialog = $<HTMLDialogElement>("exportDialog");
const edTitle = $("edTitle");
const edFill = $("edFill");
const edStatus = $("edStatus");
const edActions = $("edActions");
const edCancel = $("edCancel");
const edClose = $("edClose");
const downloadLink = $<HTMLAnchorElement>("downloadLink");

($("githubStar") as HTMLAnchorElement).href = GITHUB_REPO_URL;

/* ── state ────────────────────────────────────────────────── */
let photos: Photo[] = [];
let renderer: TimelineRenderer | null = null;
let aspectKey: keyof typeof ASPECTS = "16:9";
let playing = false;
let playT = 0;
let lastTs = 0;
let rafId = 0;
let purgeDeadline = 0;
let purgeTimerId = 0;
let currentExport: ExportHandle | null = null;
let downloadUrl: string | null = null;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── file intake ──────────────────────────────────────────── */
$("pickBtn").addEventListener("click", () => fileInput.click());
$("addBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) void addFiles([...fileInput.files]);
  fileInput.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  vfScreen.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  vfScreen.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); })
);
vfScreen.addEventListener("drop", (e) => {
  const files = [...((e as DragEvent).dataTransfer?.files ?? [])]
    .filter((f) => f.type.startsWith("image/"));
  if (files.length) void addFiles(files);
});

async function addFiles(files: File[]) {
  const room = MAX_PHOTOS - photos.length;
  if (room <= 0) return toast(`Roll is full — max ${MAX_PHOTOS} frames.`);
  if (files.length > room) {
    toast(`Only ${room} more frame${room === 1 ? "" : "s"} fit — extra photos skipped.`);
    files = files.slice(0, room);
  }

  afOverlay.hidden = false;
  dropzone.hidden = true;
  void loadFaceModel().catch(() => {/* fallback path handles it */});

  for (let i = 0; i < files.length; i++) {
    afLabel.textContent = `AF · LOCKING SUBJECT ${photos.length + 1}/${photos.length + files.length - i}`;
    try {
      const url = URL.createObjectURL(files[i]);
      const img = await loadImage(url);
      const lock = await detectSubject(img);
      photos.push({ id: crypto.randomUUID(), img, url, label: "", lock });
    } catch {
      toast(`Couldn't read ${files[i].name} — skipped.`);
    }
  }
  afOverlay.hidden = true;

  if (!photos.length) { dropzone.hidden = false; return; }
  const missed = photos.filter((p) => !p.lock.locked).length;
  if (missed) toast(`${missed} photo${missed === 1 ? "" : "s"} had no clear face — centered automatically.`);

  armPurge();
  rebuild();
  renderStrip();
  setPlaying(!reducedMotion);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/* ── timeline rebuild ─────────────────────────────────────── */
function rebuild() {
  const { w, h } = ASPECTS[aspectKey];
  canvas.width = w; canvas.height = h;
  vfScreen.dataset.aspect = aspectKey;
  hudRes.innerHTML = `${w}×${h} · ${FPS}\u2009FPS`;
  hudAspect.textContent = aspectKey;
  hudCount.textContent = `${photos.length} FRAME${photos.length === 1 ? "" : "S"}`;

  const hasFilm = photos.length >= MIN_PHOTOS;
  deck.hidden = photos.length === 0;
  stripWrap.hidden = photos.length === 0;
  exportBtn.disabled = !hasFilm;
  dropzone.hidden = photos.length > 0;

  if (!photos.length) { renderer = null; drawBlack(); return; }

  renderer = new TimelineRenderer(photos, {
    width: w, height: h,
    hold: parseFloat(holdRange.value),
    fade: 0.7,
    faceFrac: parseInt(faceRange.value, 10) / 100,
  });
  playT = Math.min(playT, renderer.duration);
  scrubTicks.innerHTML = photos.map(() => "<i></i>").join("");
  drawNow();
}

function drawBlack() {
  cctx.fillStyle = "#000";
  cctx.fillRect(0, 0, canvas.width, canvas.height);
}

/* ── preview loop ─────────────────────────────────────────── */
function tick(ts: number) {
  if (!playing || !renderer) return;
  if (!lastTs) lastTs = ts;
  playT += (ts - lastTs) / 1000;
  lastTs = ts;
  if (playT >= renderer.duration) playT = 0; // loop
  drawNow();
  rafId = requestAnimationFrame(tick);
}

function drawNow() {
  if (!renderer) return;
  renderer.drawFrame(cctx, playT);
  const pct = (playT / Math.max(renderer.duration, 0.001)) * 100;
  scrubFill.style.width = `${pct}%`;
  scrub.setAttribute("aria-valuenow", String(Math.round(pct)));
  const s = playT;
  hudTime.textContent =
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s % 1) * 10)}`;
}

function setPlaying(on: boolean) {
  playing = on && !!renderer;
  lastTs = 0;
  cancelAnimationFrame(rafId);
  hudRec.classList.toggle("paused", !playing);
  playIco.innerHTML = playing
    ? '<path fill="currentColor" d="M3 2h4v12H3zM9 2h4v12H9z"/>'
    : '<path fill="currentColor" d="M4 2.5v11l9-5.5-9-5.5Z"/>';
  if (playing) rafId = requestAnimationFrame(tick);
}
playBtn.addEventListener("click", () => setPlaying(!playing));

/* scrubbing */
function scrubTo(clientX: number) {
  if (!renderer) return;
  const r = scrub.getBoundingClientRect();
  playT = Math.min(Math.max((clientX - r.left) / r.width, 0), 1) * renderer.duration;
  drawNow();
}
scrub.addEventListener("pointerdown", (e) => {
  setPlaying(false);
  scrubTo(e.clientX);
  const move = (ev: PointerEvent) => scrubTo(ev.clientX);
  const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
});
scrub.addEventListener("keydown", (e) => {
  if (!renderer) return;
  const step = renderer.duration / 50;
  if (e.key === "ArrowRight") { playT = Math.min(playT + step, renderer.duration); drawNow(); }
  if (e.key === "ArrowLeft") { playT = Math.max(playT - step, 0); drawNow(); }
  if (e.key === " ") { e.preventDefault(); setPlaying(!playing); }
});

/* ── settings ─────────────────────────────────────────────── */
document.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("is-on"));
    btn.classList.add("is-on");
    aspectKey = btn.dataset.aspect as keyof typeof ASPECTS;
    rebuild();
  })
);
holdRange.addEventListener("input", () => {
  holdOut.textContent = `${parseFloat(holdRange.value).toFixed(1)}s`;
  rebuild();
});
faceRange.addEventListener("input", () => {
  faceOut.textContent = `${faceRange.value}%`;
  rebuild();
});
$("clearBtn").addEventListener("click", () => {
  if (photos.length && confirm("Eject all frames? Photos and film are erased from memory immediately.")) purge(true);
});

/* ── film strip (thumbs, labels, drag reorder, delete) ───── */
function renderStrip() {
  strip.innerHTML = "";
  photos.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "frame";
    el.draggable = true;
    el.dataset.id = p.id;
    el.innerHTML = `
      <img src="${p.url}" alt="Frame ${i + 1}" draggable="false" />
      ${p.lock.locked ? "" : '<span class="frame-noface">NO FACE · CENTERED</span>'}
      <button class="frame-del" type="button" aria-label="Remove frame ${i + 1}">×</button>
      <div class="frame-meta">
        <span class="frame-idx">${String(i + 1).padStart(2, "0")}</span>
        <input class="frame-label" type="text" maxlength="24" placeholder="year / caption"
               value="${escapeAttr(p.label)}" aria-label="Caption for frame ${i + 1}" />
      </div>`;
    el.querySelector(".frame-del")!.addEventListener("click", () => {
      URL.revokeObjectURL(p.url);
      photos = photos.filter((q) => q.id !== p.id);
      rebuild(); renderStrip();
    });
    el.querySelector<HTMLInputElement>(".frame-label")!.addEventListener("input", (e) => {
      p.label = (e.target as HTMLInputElement).value;
      renderer?.layout(photos);
      if (!playing) drawNow();
    });
    /* drag reorder */
    el.addEventListener("dragstart", (e) => {
      el.classList.add("dragging");
      e.dataTransfer!.setData("text/plain", p.id);
      e.dataTransfer!.effectAllowed = "move";
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dropTarget"); });
    el.addEventListener("dragleave", () => el.classList.remove("dropTarget"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("dropTarget");
      const fromId = e.dataTransfer!.getData("text/plain");
      if (!fromId || fromId === p.id) return;
      const from = photos.findIndex((q) => q.id === fromId);
      const to = photos.findIndex((q) => q.id === p.id);
      const [moved] = photos.splice(from, 1);
      photos.splice(to, 0, moved);
      rebuild(); renderStrip();
    });
    strip.appendChild(el);
  });
}
const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/* ── export ───────────────────────────────────────────────── */
if (!supportsMp4()) {
  exportBtn.innerHTML = '<span class="dot dot-red" aria-hidden="true"></span> Export video';
}
exportBtn.addEventListener("click", async () => {
  if (!renderer || photos.length < MIN_PHOTOS) return;
  setPlaying(false);
  await document.fonts.ready; // handwritten captions must be loaded before encoding

  const { w, h } = ASPECTS[aspectKey];
  const exportRenderer = new TimelineRenderer(photos, { ...renderer.opts, width: w, height: h });

  edTitle.textContent = "Developing film…";
  edActions.hidden = true;
  edCancel.hidden = false;
  edFill.style.width = "0%";
  edStatus.textContent = "Starting encoder";
  exportDialog.showModal();

  currentExport = exportFilm(
    (ctx, t) => exportRenderer.drawFrame(ctx, t),
    w, h, exportRenderer.duration,
    (frac, msg) => { edFill.style.width = `${Math.round(frac * 100)}%`; edStatus.textContent = msg; }
  );

  try {
    const { blob, ext } = await currentExport.promise;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(blob);
    downloadLink.href = downloadUrl;
    downloadLink.download = `timeline-film.${ext}`;
    downloadLink.textContent = `Download film (.${ext})`;
    edTitle.textContent = "Film developed";
    edStatus.textContent = `${(blob.size / 1e6).toFixed(1)} MB · ${ext.toUpperCase()} · ${w}×${h}`;
    edActions.hidden = false;
    edCancel.hidden = true;
    armPurge(); // restart 15:00 from generation
  } catch (err: any) {
    exportDialog.close();
    if (err?.name !== "AbortError") {
      console.error(err);
      toast("Export failed — try a smaller aspect or fewer photos.");
    }
  } finally {
    currentExport = null;
  }
});
edCancel.addEventListener("click", () => { currentExport?.cancel(); });
edClose.addEventListener("click", () => exportDialog.close());

/* ── 15-minute auto-purge ─────────────────────────────────── */
function armPurge() {
  purgeDeadline = Date.now() + PURGE_MS;
  hudPurge.hidden = false;
  clearInterval(purgeTimerId);
  purgeTimerId = window.setInterval(() => {
    const left = purgeDeadline - Date.now();
    if (left <= 0) { purge(false); return; }
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    purgeTime.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, 500);
}

function purge(manual: boolean) {
  clearInterval(purgeTimerId);
  currentExport?.cancel();
  photos.forEach((p) => URL.revokeObjectURL(p.url));
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  photos = [];
  renderer = null;
  playT = 0;
  setPlaying(false);
  hudPurge.hidden = true;
  if (exportDialog.open) exportDialog.close();
  rebuild();
  renderStrip();
  toast(manual ? "Roll ejected — memory cleared." : "15 minutes up — session wiped. Nothing was ever uploaded.");
}

/* ── toast ────────────────────────────────────────────────── */
let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function toast(msg: string) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.setAttribute("role", "status");
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl!.classList.remove("show"), 4200);
}

/* ── boot ─────────────────────────────────────────────────── */
rebuild();
drawBlack();
void mountTulip($("tulipLanding"), 150).catch(() => {});
let editorTulipMounted = false;
new MutationObserver(() => {
  if (!deck.hidden && !editorTulipMounted) {
    editorTulipMounted = true;
    void mountTulip($("tulipEditor"), 116).catch(() => {});
  }
}).observe(deck, { attributes: true, attributeFilter: ["hidden"] });
