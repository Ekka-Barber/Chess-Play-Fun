// Fetches every engine binary the registry expects, from each project's official GitHub release.
// Idempotent: an existing file of the right size is skipped, so re-running only repairs gaps.
// Windows picks are AVX2+BMI2 builds (any CPU from ~2013); edit engines.json + this table for other ISAs.
const { spawnSync } = require("node:child_process");
const { copyFileSync, createWriteStream, readdirSync } = require("node:fs");
const { mkdir, rm, stat, unlink } = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

// A fourth element names a zip member: Stockfish's releases ship a zip (the bare .exe asset vanished
// after sf_17, which silently broke the old releases/latest URL), so that entry downloads the pinned
// sf_19 zip, unpacks it with PowerShell's Expand-Archive (present on every Windows 10+) and moves the
// named executable into place. Every URL is pinned to an exact release tag.
const DOWNLOADS = [
  // [url, destination relative to the app root, expected minimum bytes, zip member basename?]
  ["https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-windows-x86-64-universal.zip",
    "stockfish/stockfish-windows-x86-64-universal.exe", 50_000_000, "stockfish-windows-x86-64-universal.exe"],
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
  for (const [url, relative, minimumBytes, member] of DOWNLOADS) {
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
      // A zip entry downloads to a .download.zip temp path (Expand-Archive refuses other extensions),
      // then the named member is unpacked and swapped into the real target below.
      const downloadPath = member ? `${target}.download.zip` : target;
      await pipeline(Readable.fromWeb(response.body), createWriteStream(downloadPath));
      const done = (await stat(downloadPath)).size;
      if (done < minimumBytes) throw new Error(`download truncated at ${mb(done)} MB`);
      if (member) {
        const unpack = `${target}.unpacked`;
        try {
          await rm(unpack, { recursive: true, force: true });
          await mkdir(unpack, { recursive: true });
          // -Command re-joins argv and re-parses it, so paths with spaces (like this project's own
          // "not shipped yet" folder) must be quoted inside the command string, not passed as args.
          const ps = (value) => `'${String(value).replace(/'/g, "''")}'`;
          const extract = spawnSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath ${ps(downloadPath)} -DestinationPath ${ps(unpack)} -Force`], { windowsHide: true });
          if (extract.status !== 0) throw new Error(`unpack failed: ${extract.stderr?.toString().trim() || `powershell exited ${extract.status}`}`);
          const found = findMember(unpack, member);
          if (!found) throw new Error(`the zip did not contain ${member}`);
          copyFileSync(found, target);
          const final = (await stat(target)).size;
          if (final < minimumBytes) throw new Error(`unpacked binary too small at ${mb(final)} MB`);
        } catch (error) {
          await unlink(target).catch(() => {}); // never leave a zip where the skip check expects an exe
          throw error;
        } finally {
          await rm(unpack, { recursive: true, force: true });
          if (member) await unlink(downloadPath).catch(() => {});
        }
      }
      console.log(`done  ${label} (${mb((await stat(target)).size)} MB)`);
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
