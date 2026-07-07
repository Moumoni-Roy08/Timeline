import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".bin": "application/octet-stream", ".png": "image/png", ".map": "application/json" };
const server = createServer(async (req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  try {
    const data = await readFile(join("dist", p));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome",
  args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:4173/");
await page.waitForSelector("#dropzone");
console.log("✓ page loaded, dropzone visible");
console.log("  github href:", await page.getAttribute("#githubStar", "href"));

// upload 4 synthetic photos
await page.setInputFiles("#fileInput", ["/tmp/test0.png", "/tmp/test1.png", "/tmp/test2.png", "/tmp/test3.png"]);
await page.waitForSelector("#deck:not([hidden])", { timeout: 60000 });
console.log("✓ deck visible after upload");
const frames = await page.locator(".frame").count();
console.log("  filmstrip frames:", frames);
const nofaces = await page.locator(".frame-noface").count();
console.log("  no-face fallbacks:", nofaces, "(face-detected:", frames - nofaces + ")");

// label first frame
await page.locator(".frame-label").first().fill("1994");

// canvas painting? sample pixels
await page.waitForTimeout(1200);
const painted = await page.evaluate(() => {
  const c = document.getElementById("previewCanvas");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4000) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
  return lit;
});
console.log(painted > 50 ? "✓ canvas painting frames (lit samples: " + painted + ")" : "✗ CANVAS BLACK");

console.log("  purge chip:", await page.textContent("#hudPurge"));

// aspect switch
await page.click('[data-aspect="9:16"]');
const dims = await page.evaluate(() => { const c = document.getElementById("previewCanvas"); return c.width + "x" + c.height; });
console.log("✓ aspect 9:16 →", dims);
await page.click('[data-aspect="16:9"]');

// export
const t0 = Date.now();
await page.click("#exportBtn");
await page.waitForSelector("#edActions:not([hidden])", { timeout: 180000 });
const status = await page.textContent("#edStatus");
const dl = await page.textContent("#downloadLink");
console.log(`✓ export finished in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${status} — ${dl}`);
const href = await page.getAttribute("#downloadLink", "href");
const size = await page.evaluate(async (h) => (await (await fetch(h)).blob()).size, href);
console.log("  blob size:", (size / 1e6).toFixed(2), "MB");

await page.screenshot({ path: "/tmp/smoke.png" });
console.log(errors.length ? "✗ console errors:\n" + errors.join("\n") : "✓ zero console errors");
await browser.close();
server.close();
