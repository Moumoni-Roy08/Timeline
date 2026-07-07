import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".bin":"application/octet-stream",".svg":"image/svg+xml"};
const server=createServer(async(req,res)=>{let p=req.url.split("?")[0];if(p==="/")p="/index.html";
try{const d=await readFile(join("dist",p));res.writeHead(200,{"content-type":MIME[extname(p)]??"application/octet-stream"});res.end(d);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(4183,r));
const b=await chromium.launch({executablePath:"/opt/google/chrome/chrome",args:["--no-sandbox","--disable-gpu","--use-gl=angle","--use-angle=swiftshader"]});
const page=await b.newPage({viewport:{width:1280,height:950}});
page.on("pageerror",e=>console.log("[pageerror]",String(e).slice(0,200)));
await page.goto("http://localhost:4183/");
await page.setInputFiles("#fileInput",["/tmp/test0.png","/tmp/test1.png","/tmp/test2.png","/tmp/test3.png"]);
await page.waitForSelector("#deck:not([hidden])",{timeout:90000});
await page.waitForTimeout(800);
const clickJs = (id) => page.evaluate((i)=>document.getElementById(i).click(), id);

// ---- TEST 1: cancel mid-export ----
await clickJs("exportBtn");
await page.waitForFunction(() => parseInt(document.getElementById("edFill").style.width) >= 20, null, { timeout: 120000 });
const t0 = Date.now();
await clickJs("edCancel");
await page.waitForFunction(() => !document.getElementById("exportDialog").open, null, { timeout: 5000 });
console.log(`CANCEL-OK dialog closed in ${Date.now()-t0}ms`);
await clickJs("playBtn");
await page.waitForTimeout(400);
console.log("APP-ALIVE after cancel");

// ---- TEST 2: full export, watch for stalls ----
await clickJs("exportBtn");
let last=-1, maxStall=0, stall=0;
const poll = setInterval(async () => {
  try {
    const w = await page.evaluate(() => parseInt(document.getElementById("edFill").style.width)||0);
    if (w===last && w>0 && w<100) { stall++; if(stall>maxStall) maxStall=stall; } else stall=0;
    last=w;
  } catch {}
}, 2000);
await page.waitForSelector("#edActions:not([hidden])",{timeout:240000});
clearInterval(poll);
console.log("EXPORT-OK", (await page.textContent("#edStatus")).trim(), `| max stall ${maxStall*2}s`);
const href = await page.getAttribute("#downloadLink","href");
const b64 = await page.evaluate(async h => {
  const buf = await (await fetch(h)).arrayBuffer();
  let s=""; const u=new Uint8Array(buf);
  for(let i=0;i<u.length;i+=8192) s+=String.fromCharCode(...u.subarray(i,i+8192));
  return btoa(s);
}, href);
await writeFile("/tmp/fixed.mp4", Buffer.from(b64,"base64"));
await b.close();server.close();
