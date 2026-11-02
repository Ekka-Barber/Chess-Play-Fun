# Stockfish 19 — how to run it on this machine

Verified working on: 12th Gen Intel Core i7-1255U, Windows 11, Git Bash.

The engine is `stockfish/stockfish-windows-x86-64-universal.exe`.
The "universal" build contains every CPU variant (modern/avx512/bmi2/avx2/sse41...)
and picks the fastest one your CPU supports automatically — no need to choose.

## Important: Stockfish is an engine, not a chess app

It has **no board, no window, no graphics**. It is a console program that speaks
the **UCI protocol** (Universal Chess Interface) over stdin/stdout. You type
text commands, it replies with text. To *see* a board and play, you either:

1. Use a GUI that loads UCI engines (Arena, Banksia GUI, Scid, etc.), or
2. Build your own app that talks UCI to the exe (this is the point of the CHESS project).

## Quick test from a terminal

```bash
cd stockfish
(printf "uci\nsetoption name Threads value 8\nsetoption name Hash value 256\nposition startpos\ngo movetime 3000\n"; sleep 6) | ./stockfish-windows-x86-64-universal.exe
```

The `sleep` matters: if stdin closes early, Stockfish stops searching immediately.
The answer arrives on the final line, e.g. `bestmove g1f3 ponder b8c6`.

## UCI cheat sheet

| Command | Meaning |
|---|---|
| `uci` | handshake; engine replies `uciok` |
| `isready` | ping; engine replies `readyok` |
| `setoption name Threads value 8` | search threads (CPU has 12 logical cores; 8 is a good balance) |
| `setoption name Hash value 256` | transposition table size in MB |
| `position startpos` | load the start position |
| `position startpos moves e2e4 e7e5` | load start position + moves (long algebraic, e2→e4 = `e2e4`) |
| `position fen <FEN>` | load any position by FEN |
| `go depth 20` | search to depth 20 |
| `go movetime 3000` | search for 3 seconds |
| `go wtime 60000 btime 60000 winc 1000 binc 1000` | tournament clock mode |
| `stop` | stop searching now, emit bestmove |
| `quit` | exit |
| `uci` reply: `bestmove g1f3 ponder b8c6` | its move + expected reply |

### Making it weaker (for a playable opponent)

```
setoption name Skill Level value 10        # 0–20, 20 = full strength
setoption name UCI_LimitStrength value true
setoption name UCI_Elo value 1800          # 1320–3190
```

## Measured performance on this laptop (i7-1255U)

- ~3,000,000 nodes/second with `Threads 8`
- Depth 20 from the opening position in ~1.1 s
- NNUE net embedded in the exe (`nn-1a298aa575a0.nnue`, 109 MiB) — no extra files needed

## Driving it from code (Node.js example)

```js
const { spawn } = require("child_process");
const sf = spawn("stockfish/stockfish-windows-x86-64-universal.exe");
sf.stdin.write("uci\nsetoption name Threads value 8\nisready\n");
sf.stdout.on("data", (d) => {
  const line = d.toString();
  if (line.includes("bestmove")) console.log("Engine move:", line.trim());
});
sf.stdin.write("position startpos moves e2e4\ngo movetime 1000\n");
```

Keep the process alive and send `position ... moves <full history>` before each
`go` — Stockfish is stateless between commands about the game itself.
