# CHESS

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

A local chess app. The user plays against Stockfish 19 (ten strength steps) or moves both colours in free play, in standard chess or Chess960. A coach grades and explains moves; brilliant moves are saved as board images.

## Capabilities and Constraints

Enforce standard chess rules and alternating turns, including promotion, castling, en passant, and check. The user explicitly rejected the incumbent free-edit behavior. Preserve opening names, move classifications, suggested variations, hypothetical threats, evaluation history, branching, undo, and board orientation. A resource governor caps the three engine processes: the header's Power control picks full, balanced (default) or laptop budgets — per-mode thread, hash and deep-review priority settings that retune running engines live. Engines come from the engines.json registry (`{id, name, path, chess960}`); entries whose executable is missing are skipped, and a broken or empty file falls back to the bundled Windows Stockfish executable. Mouse dragging, touch dragging, click-to-move, and keyboard operation must work. Keep the existing Express and vanilla HTML/CSS/JavaScript stack.

## Brand Commitments

The user approved a focused tournament workspace with a large crisp board, real chess pieces, restrained forest tones, and clear adjacent analysis.

## Evidence on Hand

Existing functionality in server.js and public/. Opening data in data/openings.json. Local Stockfish 19 distribution in stockfish/.

## Product Principles

Board interaction takes priority. Analysis never blocks moving pieces. Errors are visible and recoverable. Standard chess rules apply even though the human operates both sides.
