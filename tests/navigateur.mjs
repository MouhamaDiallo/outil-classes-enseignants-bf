// Banc de test dans un vrai navigateur (Chrome sans fenêtre, piloté par son protocole de débogage).
// Ouvre une adresse, attend en temps réel, puis évalue une expression et prend une capture d'écran.
// Lancer : node tests/navigateur.mjs <adresse> <attente_ms> <capture.png> [expression JS] [clics : sélecteurs séparés par ||]
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [adresse, attente = "15000", capture = "capture.png", expression = "document.title", clics = ""] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const port = 9300 + Math.floor(Math.random() * 500);
const profil = mkdtempSync(join(tmpdir(), "chrome-test-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profil}`, `--window-size=${process.env.LARGEUR ?? 1366},${process.env.HAUTEUR ?? 2000}`, "about:blank"], { stdio: "ignore" });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

let cible;
for (let i = 0; i < 50 && !cible; i++) {
  await pause(200);
  try { cible = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* pas encore prêt */ }
}
const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const attentes = new Map(), journal = [];
ws.addEventListener("message", (m) => {
  const d = JSON.parse(m.data);
  if (d.id && attentes.has(d.id)) { attentes.get(d.id)(d.result); attentes.delete(d.id); }
  if (d.method === "Runtime.consoleAPICalled") journal.push(`[console.${d.params.type}] ${d.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (d.method === "Runtime.exceptionThrown") journal.push(`[exception] ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
});
const cmd = (method, params = {}) => new Promise((r) => { const n = ++id; attentes.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

await cmd("Runtime.enable");
await cmd("Page.enable");
const LARGEUR = +(process.env.LARGEUR ?? 1366), HAUTEUR = +(process.env.HAUTEUR ?? 2000);
await cmd("Emulation.setDeviceMetricsOverride", { width: LARGEUR, height: HAUTEUR, deviceScaleFactor: 1, mobile: LARGEUR < 700 });
await cmd("Page.navigate", { url: adresse });
await pause(+attente);
for (const sel of clics.split("||").filter(Boolean)) {
  await cmd("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(sel)})?.click()` });
  await pause(4000);
}
const r = await cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
console.log("RÉSULTAT :", JSON.stringify(r.result?.value ?? r.exceptionDetails?.text));
const img = await cmd("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(capture, Buffer.from(img.data, "base64"));
journal.forEach((l) => console.log(l));
ws.close();
chrome.kill();
