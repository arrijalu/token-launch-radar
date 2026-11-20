import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname } from "node:path";

const PORT = 8085;
const PUBLIC_DIR = join(process.cwd(), "output");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png"
};

const server = createServer((req, res) => {
  const urlPath = req.url === "/" ? "/dashboard/index.html" : req.url;
  const filePath = join(PUBLIC_DIR, urlPath.split("?")[0]);
  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  mkdirSync("output/screenshots", { recursive: true });
  mkdirSync("screenshots", { recursive: true });

  const chromePath = "/home/hermes/.cache/ms-playwright/chromium-1148/chrome-linux/chrome";
  const url = `http://localhost:${PORT}/dashboard/index.html`;

  const child = spawn(chromePath, [
    "--headless",
    "--window-size=1440,1040",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--no-sandbox",
    "--remote-debugging-port=9222"
  ], { stdio: "ignore" });

  await sleep(2500);

  const res = await fetch("http://localhost:9222/json");
  const targets = await res.json();
  const target = targets.find(t => t.type === "page") || targets[0];
  const wsUrl = target.webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener("open", r));

  let id = 1;
  const send = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      const handler = (event) => {
        const data = JSON.parse(event.data);
        if (data.id === msgId) {
          ws.removeEventListener("message", handler);
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false
  });

  async function waitForSelector(selector, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await send("Runtime.evaluate", {
        expression: `!!document.querySelector('${selector}')`
      });
      if (res.result && res.result.value === true) return true;
      await sleep(100);
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  // 1. Board screenshot
  await send("Page.navigate", { url: url + "#/" });
  await waitForSelector("#board-tbody tr");
  await sleep(800);
  let sc1 = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const buf1 = Buffer.from(sc1.data, "base64");
  writeFileSync("output/screenshots/1-board.png", buf1);
  writeFileSync("screenshots/1-board.png", buf1);
  console.log(`Captured 1-board.png (${buf1.length} bytes), dims: ${buf1.readUInt32BE(16)}x${buf1.readUInt32BE(20)}`);

  // 2. Detail screenshot (9summits)
  await send("Page.navigate", { url: url + "#/p/9summits" });
  await waitForSelector(".detail-view");
  await sleep(800);
  let sc2 = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const buf2 = Buffer.from(sc2.data, "base64");
  writeFileSync("output/screenshots/2-detail.png", buf2);
  writeFileSync("screenshots/2-detail.png", buf2);
  console.log(`Captured 2-detail.png (${buf2.length} bytes), dims: ${buf2.readUInt32BE(16)}x${buf2.readUInt32BE(20)}`);

  // 3. Filtered screenshot (Risk Curators + watchlist-only)
  await send("Page.navigate", { url: url + "#/" });
  await waitForSelector("#board-tbody tr");
  await send("Runtime.evaluate", {
    expression: `
      document.getElementById('filter-category').value = 'Risk Curators';
      document.getElementById('filter-category').dispatchEvent(new Event('change'));
      document.getElementById('filter-watchlist').checked = true;
      document.getElementById('filter-watchlist').dispatchEvent(new Event('change'));
    `
  });
  await sleep(800);
  let sc3 = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 } });
  const buf3 = Buffer.from(sc3.data, "base64");
  writeFileSync("output/screenshots/3-filtered.png", buf3);
  writeFileSync("screenshots/3-filtered.png", buf3);
  console.log(`Captured 3-filtered.png (${buf3.length} bytes), dims: ${buf3.readUInt32BE(16)}x${buf3.readUInt32BE(20)}`);

  ws.close();
  child.kill();
  server.close();
}

main().catch(err => {
  console.error("Error taking screenshots:", err);
  process.exit(1);
});
