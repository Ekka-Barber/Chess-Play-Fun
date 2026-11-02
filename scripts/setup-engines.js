// Fetches every engine binary the registry expects, from each project's official GitHub release.
// Idempotent: an existing file of the right size is skipped, so re-running only repairs gaps.
// Windows picks are AVX2+BMI2 builds (any CPU from ~2013); edit engines.json + this table for other ISAs.
const { createWriteStream } = require("node:fs");
const { mkdir, stat, unlink } = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const DOWNLOADS = [
  // [url, destination relative to the app root, expected minimum bytes]
  ["https://github.com/official-stockfish/Stockfish/releases/latest/download/stockfish-windows-x86-64-universal.exe",
    "stockfish/stockfish-windows-x86-64-universal.exe", 50_000_000],
  ["https://github.com/jhonnold/berserk/releases/download/14/berserk-14-avx2-pext.exe",
    "engines/berserk/berserk-14-avx2-pext.exe", 10_000_000],
  ["https://github.com/jhonnold/berserk/releases/download/14/berserk-9b84c340af7e.nn",
    "engines/berserk/berserk-9b84c340af7e.nn", 10_000_000],
  ["https://github.com/gab8192/Obsidian/releases/download/v16.0/Obsidian160-avx2-pext.exe",
    "engines/obsidian/Obsidian160-avx2-pext.exe", 10_000_000],
  ["https://github.com/Yoshie2000/PlentyChess/releases/download/b-v8.0.0/PlentyChess-8.0.0-windows-avx2.exe",
    "engines/plentychess/PlentyChess-8.0.0-windows-avx2.exe", 10_000_000],
  ["https://github.com/cosmobobak/viridithas/releases/download/v20.0.0/viridithas-20-win-x86-64-v3.exe",
    "engines/viridithas/viridithas-20-win-x86-64-v3.exe", 10_000_000],
];

const mb = (bytes) => (bytes / 1e6).toFixed(1);

(async () => {
  const root = path.join(__dirname, "..");
  let failures = 0;
  for (const [url, relative, minimumBytes] of DOWNLOADS) {
    const target = path.join(root, relative);
    const label = path.basename(relative);
    try {
      const existing = await stat(target).then((info) => info.size, () => 0);
      if (existing >= minimumBytes) {
        console.log(`skip  ${label} (${mb(existing)} MB already present)`);
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      if (existing > 0) await unlink(target).catch(() => {});
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const total = +(response.headers.get("content-length") || 0);
      console.log(`get   ${label}${total ? ` (${mb(total)} MB)` : ""}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
      const done = (await stat(target)).size;
      if (done < minimumBytes) throw new Error(`download truncated at ${mb(done)} MB`);
      console.log(`done  ${label} (${mb(done)} MB)`);
    } catch (error) {
      failures++;
      console.error(`FAIL  ${label}: ${error.message}`);
    }
  }
  if (failures) {
    console.error(`\n${failures} download(s) failed. Re-run this script to retry; the engines are also linked in the README.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll engines ready. Start the app with: npm start");
  }
})();
