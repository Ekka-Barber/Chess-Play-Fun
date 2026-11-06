// Fetches every engine binary the registry expects, from each project's official GitHub release.
// Idempotent: an existing file of the right size is skipped, so re-running only repairs gaps.
// Windows picks are AVX2+BMI2 builds (any CPU from ~2013); edit engines.json + this table for other ISAs.
const { spawnSync } = require("node:child_process");
const { createWriteStream, readdirSync } = require("node:fs");
const { mkdir, mkdtemp, rename, rm, stat } = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const DOWNLOADS = [
  // [pinned URL, executable path, minimum bytes, zip member basename?, companion files?]
  ["https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip",
    "stockfish/stockfish-windows-x86-64-universal.exe", 50_000_000, "stockfish-windows-x86-64-universal.exe"],
  ["https://github.com/Yoshie2000/PlentyChess/releases/download/b-v8.0.0/PlentyChess-8.0.0-windows-avx2.exe",
    "engines/plentychess/PlentyChess-8.0.0-windows-avx2.exe", 10_000_000],
  ["https://github.com/LeelaChessZero/lc0/releases/download/v0.32.1/lc0-v0.32.1-windows-cpu-dnnl.zip",
    "engines/lc0/lc0.exe", 2_000_000, "lc0.exe",
    ["791556.pb.gz", "dnnl.dll", "mimalloc-override.dll", "mimalloc-redirect.dll"]],
  ["https://github.com/Tors3/Triumviratus/releases/download/v8.0/Triumviratus_8.0_windows_universal.exe",
    "engines/triumviratus/Triumviratus_8.0_windows_universal.exe", 173_041_664],
  ["https://github.com/codedeliveryservice/Reckless/releases/download/v0.9.0/reckless-windows-avx2.exe",
    "engines/reckless/reckless-windows-avx2.exe", 64_664_576],
];

const mb = (bytes) => (bytes / 1e6).toFixed(1);
const fileSize = async (file) => (await stat(file).catch(() => null))?.size ?? 0;

// Finds one file by basename under a directory tree (the Stockfish zip nests a top-level stockfish/ folder).
function findMember(root, name) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) { const found = findMember(full, name); if (found) return found; }
    else if (entry.name === name) return full;
  }
  return null;
}

(async () => {
  const root = path.join(__dirname, "..");
  let failures = 0;
  for (const [url, relative, minimumBytes, member, companions = []] of DOWNLOADS) {
    const target = path.join(root, relative);
    const directory = path.dirname(target);
    const label = path.basename(relative);
    let staging;
    try {
      const existing = await fileSize(target);
      const companionSizes = await Promise.all(companions.map((file) => fileSize(path.join(directory, file))));
      if (existing >= minimumBytes && companionSizes.every((size) => size > 0)) {
        console.log(`skip  ${label} (${mb(existing)} MB already present)`);
        continue;
      }
      await mkdir(directory, { recursive: true });
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const total = +(response.headers.get("content-length") || 0);
      console.log(`get   ${label}${total ? ` (${mb(total)} MB)` : ""}`);
      staging = await mkdtemp(`${target}.download-`);
      const downloadPath = path.join(staging, member ? "engine.zip" : label);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(downloadPath));
      const done = (await stat(downloadPath)).size;
      if (done < minimumBytes) throw new Error(`download truncated at ${mb(done)} MB`);
      if (member) {
        const unpack = path.join(staging, "unpacked");
        // -Command re-parses argv, so quote paths with spaces inside the command string.
        const ps = (value) => `'${String(value).replace(/'/g, "''")}'`;
        const extract = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${ps(downloadPath)} -DestinationPath ${ps(unpack)} -Force`], { windowsHide: true });
        if (extract.status !== 0) throw new Error(`unpack failed: ${extract.stderr?.toString().trim() || `powershell exited ${extract.status}`}`);
        const executable = findMember(unpack, member);
        if (!executable || await fileSize(executable) < minimumBytes) throw new Error(`missing or truncated ${member}`);
        for (const file of companions) {
          const source = path.join(path.dirname(executable), file);
          if (!await fileSize(source)) throw new Error(`missing or empty ${file}`);
          await rename(source, path.join(directory, file));
        }
        await rename(executable, target);
      } else await rename(downloadPath, target);
      console.log(`done  ${label} (${mb((await stat(target)).size)} MB)`);
    } catch (error) {
      failures++;
      console.error(`FAIL  ${label}: ${error.message}`);
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true });
    }
  }
  if (failures) {
    console.error(`\n${failures} download(s) failed. Re-run this script to retry; the engines are also linked in the README.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll engines ready. Start the app with: npm start");
  }
})();
