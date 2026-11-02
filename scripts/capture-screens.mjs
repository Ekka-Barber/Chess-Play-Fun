// Captures the README's real screenshots through Chromium's DevTools protocol — no dependencies, the same
// CDP-over-WebSocket pattern as test/browser.cjs (Node >= 21 for the global WebSocket).
//   node scripts/capture-screens.mjs <cdp-port>            (app expected on localhost:4655, or set PORT)
//   node scripts/capture-screens.mjs <cdp-port> <app-port> (e.g. 4677 for a throwaway instance)
// Shots land in assets/screens/: the ranked best-line ladder on the Analysis tab, and the five-engine
// coach view (one coloured arrow + legend row per registry engine). The engines run for real.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const [cdpPort, appPort = process.env.PORT || 4655] = process.argv.slice(2);
if (!cdpPort) { console.error("Usage: node scripts/capture-screens.mjs <cdp-port> [app-port]"); process.exit(1); }
const OUT = path.join(import.meta.dirname, "..", "assets", "screens");

const tabs = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
const target = tabs.find((tab) => tab.type === "page");
if (!target) throw new Error("No page target on the debugging port.");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject, { once: true }); });
let sequence = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data), request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id); clearTimeout(request.timer);
  message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 90000);
  pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};
const wait = async (expression, ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expression)) return; await delay(120); }
  throw new Error(`Condition failed: ${expression}`);
};
const shot = async (name) => {
  await evaluate("document.fonts.ready");
  await wait(`document.querySelector('#toast').classList.contains('hidden')`);
  const image = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(OUT, name), Buffer.from(image.data, "base64"));
  console.log(`captured ${name}`);
};

await mkdir(OUT, { recursive: true });
try {
  await send("Page.enable");
  const loaded = new Promise((resolve) => socket.addEventListener("message", ({ data }) => { if (JSON.parse(data).method === "Page.loadEventFired") resolve(); }, { once: false }));
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 960, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${appPort}/` });
  await loaded;
  await wait(`typeof game!=='undefined' && game && !busy && analysis?.phase==='ready' && document.querySelector('.line .play')`);
  await delay(600); // let the ranked arrows settle into the DOM diff
  await evaluate(`document.querySelector('#tabAnalysis').click()`);
  await wait(`!document.querySelector('#analysisPanel').classList.contains('hidden')`);
  await shot("app-analysis.png");

  // Engines mode: cycle Best -> Engines and let the sequential sweep finish (cold engines respawn first).
  await evaluate(`document.querySelector('#coach').click()`);
  await wait(`analysis?.sweep?.phase==='ready'`, 120000);
  await delay(600);
  await shot("app-engine-votes.png");
  const count = await evaluate(`document.querySelectorAll('#arrows polygon').length`);
  console.log(`engine arrows on screen: ${count}`);
} finally {
  socket.close();
}
