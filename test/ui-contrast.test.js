// Pins two different colour laws, one per layer.
//
// ARROWS (decorative annotations): the panel rows and the engine band carry the same facts as text, so
// arrows follow the reference boards — read from what lichess's chessground actually ships (brush table in
// src/state.ts) and chess.com's game-review arrows — SATURATED mid-tone global colours drawn TRANSLUCENT
// with fat shafts. This suite pins that profile: every arrow colour stays inside the vivid mid-tone band,
// the five engine hues stay pairwise hue-separated, the best-line ladder descends in opacity and width
// (darker = stronger), and drawArrows takes its colours only from the shared constants. A regression to
// the near-black "contrast-legal" tints (which nobody could read at a glance) fails here.
//
// ESSENTIAL OVERLAYS (legal-move dot, check disc, last-move ring): these mark interactive state, so they
// keep the hard floor — >=3:1 composited against BOTH square colours in every theme (WCAG 1.4.11), plus
// the badge contrast laws. Sources are parsed - not redeclared - so a retuned hex fails here, not in prod.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const themes = require("../public/themes.js");

const appJs = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const styleCss = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");
const archiveJs = fs.readFileSync(path.join(__dirname, "..", "lib", "archive.js"), "utf8");

// WCAG 2.x relative luminance and contrast; alpha composites blend in gamma-encoded sRGB space,
// the model browsers use for simple alpha, so a translucent overlay is measured as rendered.
const channels = (hexColor) => {
  const digits = hexColor.length === 4 ? hexColor.slice(1).split("").map((x) => x + x).join("") : hexColor.slice(1);
  return [0, 1, 2].map((i) => parseInt(digits.slice(i * 2, i * 2 + 2), 16));
};
const luminance = ([r, g, b]) => {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
};
const composite = (fg, alpha, bg) => channels(fg).map((c, i) => Math.round(c * alpha + channels(bg)[i] * (1 - alpha)));
const hexOf = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
// Simple HSV hue in degrees; enough to assert hue separation where luminance cannot carry it.
const hue = (hexColor) => {
  const [r, g, b] = channels(hexColor).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };

// The BADGES IIFE is self-contained; evaluating the extracted block yields the real SVG markup.
const badges = (() => {
  const block = appJs.match(/const BADGES = \(\(\) => \{[\s\S]*?\}\)\(\);/);
  assert.ok(block, "BADGES block not found in public/app.js");
  return new Function(`${block[0]}; return BADGES;`)();
})();
const glyphInk = (svg) => {
  const glyphMarkup = svg.replace(/<circle[^>]*\/>/, ""); // disc first, glyph second
  return (glyphMarkup.match(/(?:fill|stroke)="([^"]+)"/g) ?? [])
    .map((attr) => attr.match(/"([^"]+)"/)[1])
    .find((value) => value.startsWith("#"));
};
const cssRule = (selector) =>
  styleCss.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"))?.[1] ?? "";
const cssProp = (rule, prop) => rule.match(new RegExp(prop + ":\\s*([^;]+)"))?.[1]?.trim();
const drawArrowsBody = () => (appJs.match(/function drawArrows\(live, sweepLive\) \{[\s\S]*?\n\}/)?.[0] ?? "").replace(/\/\/.*$/gm, "");

// The shared arrow constants, extracted so a retuned constant is measured, not trusted.
const arrowConsts = (() => {
  const palette = appJs.match(/const ENGINE_PALETTE = \[[\s\S]*?\];/)?.[0];
  const arrows = appJs.match(/const ARROWS = \{[\s\S]*?\n\};/)?.[0];
  assert.ok(palette && arrows, "ENGINE_PALETTE / ARROWS blocks not found in public/app.js");
  return new Function(`${palette}\n${arrows}; return { ENGINE_PALETTE, ARROWS };`)();
})();

test('returning to engine votes requests fresh state after stop; hidden tabs never restart a sweep', async () => {
  const block = appJs.match(/const stopSweepRemote =[\s\S]*?(?=\n\/\/ The registry loads)/)?.[0];
  assert.ok(block, 'sweep lifecycle block exists');
  const calls = [], timers = [], page = { hidden: false };
  const setup = `let arrowMode='engines',retry=null,sweepTimer=0,viewIndex=0;
    const game={revision:1,computer:{phase:'idle'}},currentFen=()=>'position',pollAnalysis=()=>{};
    const analysis={sweep:{fen:'position',ply:0,phase:'ready'}};`;
  const controls = new Function('api', 'setTimeout', 'clearTimeout', 'document', `${setup}\n${block};return {stopSweepRemote,scheduleSweep};`)(
    (route, body) => { calls.push(body); return Promise.resolve({}); },
    callback => { timers.push(callback); return timers.length; }, () => {}, page);
  await controls.stopSweepRemote();
  controls.scheduleSweep();
  timers.shift()?.();
  assert.equal(calls.filter(body => body.fen === 'position').length, 1, 'a stopped server cannot be mistaken for the old ready result');
  page.hidden = true;
  controls.scheduleSweep();
  assert.equal(timers.length, 0, 'a hidden poll cannot restart work that visibility paused');
});

test("every move-quality badge glyph keeps >=3:1 against its disc", () => {
  for (const [type, { color, svg }] of Object.entries(badges)) {
    const ink = glyphInk(svg);
    assert.ok(ink, `glyph colour not found for ${type}`);
    const ratio = contrast(channels(color), channels(ink));
    assert.ok(ratio >= 3, `${type}: glyph ${ink} on disc ${color} is ${ratio.toFixed(2)}:1, needs 3:1`);
  }
});

test("brilliant-count badge text keeps >=4.5:1 and shares the brilliant disc colour", () => {
  const rule = cssRule("#collectionCount:not(:empty)");
  const background = cssProp(rule, "background"), color = cssProp(rule, "color");
  assert.ok(/^#[0-9a-f]{6}$/i.test(background) && /^#[0-9a-f]{3,6}$/i.test(color), "count badge colours not parseable");
  const ratio = contrast(channels(background), channels(color));
  assert.ok(ratio >= 4.5, `count badge ${color} on ${background} is ${ratio.toFixed(2)}:1, needs 4.5:1 (11px text)`);
  assert.equal(background.toLowerCase(), badges.brilliant.color.toLowerCase(),
    "style.css count badge drifted from BADGES.brilliant in app.js");
});

test("the archive PNG brilliant badge matches the app badge and keeps >=3:1", () => {
  const badgeLine = archiveJs.split("\n").find((line) => line.includes("data-badge="));
  assert.ok(badgeLine, "badge markup not found in lib/archive.js");
  const disc = badgeLine.match(/<circle[^>]*fill="(#[0-9a-f]{3,6})"/i)?.[1];
  const ink = badgeLine.match(/<text[^>]*fill="(#[0-9a-f]{3,6})"/i)?.[1];
  assert.equal(disc?.toLowerCase(), badges.brilliant.color.toLowerCase(), "archive image badge drifted from app.js");
  const ratio = contrast(channels(disc), channels(ink));
  assert.ok(ratio >= 3, `archive badge ${ink} on ${disc} is ${ratio.toFixed(2)}:1, needs 3:1`);
});

test("arrow colours keep the reference-board vivid profile (saturated mid-tones, never contrast-black)", () => {
  const { ENGINE_PALETTE, ARROWS } = arrowConsts;
  const arrowColors = [ARROWS.best.color, ARROWS.threat.color, ...ENGINE_PALETTE.map((entry) => entry.hue)];
  for (const hex of arrowColors) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(hex), `arrow colour ${hex} must be a 6-digit hex`);
    const lum = luminance(channels(hex));
    assert.ok(lum >= 0.04 && lum <= 0.42,
      `${hex} sits at luminance ${lum.toFixed(3)} — arrows must stay vivid mid-tones (0.04-0.42), not near-black tints`);
  }
});

test("the five engine hues stay pairwise separated and clear of the threat red", () => {
  const { ENGINE_PALETTE, ARROWS } = arrowConsts;
  assert.ok(ENGINE_PALETTE.length >= 5, "a full registry needs five engine colours");
  for (let i = 0; i < ENGINE_PALETTE.length; i++) {
    assert.ok(hueGap(ARROWS.threat.color, ENGINE_PALETTE[i].hue) >= 30,
      `engine hue ${ENGINE_PALETTE[i].hue} sits within 30° of threat red ${ARROWS.threat.color}`);
    for (let j = i + 1; j < ENGINE_PALETTE.length; j++) {
      assert.ok(hueGap(ENGINE_PALETTE[i].hue, ENGINE_PALETTE[j].hue) >= 40,
        `engine hues ${ENGINE_PALETTE[i].hue} and ${ENGINE_PALETTE[j].hue} are ${hueGap(ENGINE_PALETTE[i].hue, ENGINE_PALETTE[j].hue).toFixed(0)}° apart, need 40°`);
    }
  }
  assert.ok(hueGap(ARROWS.best.color, ARROWS.threat.color) >= 60, "best-move green and threat red must stay far apart");
});

test("the best-line ladder descends in opacity and width (darker = stronger), threats stay slimmer", () => {
  const { ARROWS } = arrowConsts;
  const { opacities, widths } = ARROWS.best;
  assert.equal(opacities.length, 3);
  assert.equal(widths.length, 3);
  for (let i = 1; i < 3; i++) {
    assert.ok(opacities[i] < opacities[i - 1], "rank opacities must strictly descend");
    assert.ok(widths[i] < widths[i - 1], "rank widths must strictly descend");
  }
  assert.ok(opacities[0] >= 0.7 && opacities[0] < 1, "rank 1 is near-solid but keeps the board readable under it");
  assert.ok(opacities[2] <= 0.35, "rank 3 is a breath — the light end of the ladder");
  assert.ok(ARROWS.threat.opacities[0] < opacities[0] && ARROWS.threat.widths[0] < widths[0],
    "threats never out-shadow the best line");
  assert.ok(ARROWS.engine.opacity >= 0.4 && ARROWS.engine.opacity <= 0.7, "engine arrows stay firmly translucent (chessground pale-brush band)");
  assert.ok(ARROWS.engine.width <= 14 && widths[0] <= 14, "shafts leave the majority of each square visible");
  // The ladder must be composited-visible on the lightest shipped square: rank 3 over the lightest theme
  // square still shifts it perceptibly (>1.15:1 against the square it covers).
  const lightestSquare = Object.values(themes).map((t) => t.light).sort((a, b) => luminance(channels(b)) - luminance(channels(a)))[0];
  const rendered = hexOf(composite(ARROWS.best.color, opacities[2], lightestSquare));
  assert.ok(contrast(channels(rendered), channels(lightestSquare)) > 1.15,
    `rank 3 at opacity ${opacities[2]} must still be visible on the lightest square (got ${contrast(channels(rendered), channels(lightestSquare)).toFixed(2)}:1)`);
});

test("ENGINE_ARROWS spreads agreeing engines and never clips a fat arrowhead off the board", () => {
  // arrowPoints + ENGINE_ARROWS are evaluated together (the planner calls the geometry helper), the same
  // headless-extraction trick as BADGES.
  const geometry = appJs.match(/function arrowPoints\(from, to, width, proj\) \{[\s\S]*?\n\}/)?.[0];
  const planner = appJs.match(/const ENGINE_ARROWS = \(\(\) => \{[\s\S]*?\}\)\(\);/)?.[0];
  assert.ok(geometry && planner, "arrowPoints / ENGINE_ARROWS blocks not found in public/app.js");
  const { plan } = new Function(`${geometry}\n${planner}; return ENGINE_ARROWS;`)();
  const FILES = "abcdefgh";
  const proj = (sq) => [FILES.indexOf(sq[0]) * 100 + 50, (8 - +sq[1]) * 100 + 50];
  const palette = [{ hue: "#111111" }, { hue: "#222222" }, { hue: "#333333" }, { hue: "#444444" }, { hue: "#555555" }];
  const style = arrowConsts.ARROWS.engine;
  const votes = (from, to) => [1, 2, 3, 4, 5].map((slot) => ({ engineId: `e${slot}`, name: `E${slot}`, from, to, uci: from + to }));
  const inBounds = (polygons) => {
    assert.ok(polygons.length > 0, "planner returned no arrows");
    for (const { points } of polygons) {
      for (const [x, y] of points) {
        assert.ok(x >= -1e-6 && x <= 800 + 1e-6 && y >= -1e-6 && y <= 800 + 1e-6,
          `point ${x.toFixed(1)},${y.toFixed(1)} left the 0..800 viewBox — the centreward clamp failed`);
      }
    }
  };
  // Five-way agreement on the worst cases: both board-edge files and a long diagonal.
  for (const [from, to] of [["a2", "a4"], ["h2", "h4"], ["a1", "h8"], ["e2", "e4"]]) {
    const polygons = plan(votes(from, to), proj, palette, style);
    assert.equal(polygons.length, 5, `${from}${to}: one arrow per agreeing engine`);
    inBounds(polygons);
    // Even at the board edge, agreeing votes keep distinct lanes.
    for (let i = 0; i < polygons.length; i++) {
      for (let j = i + 1; j < polygons.length; j++) {
        const spread = Math.max(...polygons[i].points.flatMap((p, n) =>
          [Math.abs(p[0] - polygons[j].points[n][0]), Math.abs(p[1] - polygons[j].points[n][1])]));
        assert.ok(spread >= 2 - 1e-6, `${from}${to}: arrows ${i} and ${j} overlap completely (max delta ${spread.toFixed(2)})`);
      }
    }
    for (const polygon of polygons) {
      assert.equal(polygon.opacity, style.opacity);
      assert.equal(polygon.fill, palette[Number(polygon.id.slice("engine-e".length)) - 1].hue, "colour follows the registry slot");
    }
  }
  // A single engine's vote draws one unshifted arrow; disagreement draws one arrow per group.
  assert.equal(plan(votes("e2", "e4").slice(0, 1), proj, palette, style).length, 1);
  const split = [votes("e2", "e4")[0], { ...votes("d2", "d4")[1] }];
  assert.equal(plan(split, proj, palette, style).length, 2);
  // Skipped and errored engines draw nothing.
  assert.equal(plan([{ engineId: "x", name: "X", skipped: "chess960" }, { engineId: "y", name: "Y", error: "boom" }], proj, palette, style).length, 0);
  const stationaryCastle = votes('g1', 'h1').map(r => ({ ...r, displayTo: 'g1' }));
  const castleArrows = plan(stationaryCastle, proj, palette, style);
  assert.equal(castleArrows.length, 5, 'stationary-king Chess960 castling points toward the rook');
  inBounds(castleArrows);
});

test("essential overlays clear 3:1 on both square colours in every theme (dot, check disc, ring)", () => {
  for (const [key, theme] of Object.entries(themes)) {
    for (const overlay of ["arrowThreat", "target"]) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(theme[overlay] ?? ""), `theme ${key} is missing a ${overlay} colour`);
      for (const square of ["light", "dark"]) {
        const ratio = contrast(channels(theme[overlay]), channels(theme[square]));
        assert.ok(ratio >= 3, `${key} ${overlay} ${theme[overlay]} on ${square} ${theme[square]} is ${ratio.toFixed(2)}:1, needs 3:1`);
      }
    }
  }
});

test("overlays stay wired: arrows to the shared constants, essentials to theme tokens", () => {
  const body = drawArrowsBody();
  assert.ok(body, "drawArrows(live, sweepLive) not found in public/app.js");
  // Arrows take colours ONLY from the shared constants — no theme tints, no stray hexes.
  assert.ok(["ARROWS.best.color", "ARROWS.best.opacities", "ARROWS.best.widths", "ARROWS.threat.color", "ARROWS.threat.opacities", "ARROWS.threat.widths", "ENGINE_PALETTE", "ARROWS.engine"].every((token) => body.includes(token)),
    "drawArrows must style arrows from the ARROWS / ENGINE_PALETTE constants");
  assert.ok(!/#[0-9a-f]{6}/i.test(body), "drawArrows must not hard-code arrow colours");
  const calls = [...body.matchAll(/arrow\(([^)]*)\)/g)];
  assert.ok(calls.length >= 2, "expected the suggestion and threat arrow call sites in drawArrows");
  // The legal-move dot, check disc and last-move ring are interactive/essential: theme tokens at >=3:1.
  assert.equal(cssProp(cssRule(".square.target::after"), "background"), "var(--target)",
    "legal-move dot must use var(--target)");
  assert.ok(cssProp(cssRule(".square.target.capture::after"), "background").includes("var(--target)"),
    "capture ring must use var(--target)");
  const check = cssRule(".square.check::after");
  assert.equal(cssProp(check, "background"), "var(--arrow-threat)", "the check disc must use the threat token");
  assert.ok(!/opacity\s*:/.test(check) || parseFloat(check.match(/opacity\s*:\s*([\d.]+)/)[1]) >= 1,
    "a translucent check disc would re-composite below the floor");
  assert.ok(cssRule(".square.lastmove::before").includes("var(--target)"), "the last-move cue's contrast carrier is its var(--target) ring");
  // :root carries the Classic defaults, so the no-JS first paint matches themes.classic exactly.
  const root = cssRule(":root");
  for (const [cssVar, themeKey] of [["--arrow-threat", "arrowThreat"], ["--target", "target"]]) {
    assert.equal(cssProp(root, cssVar)?.toLowerCase(), themes.classic[themeKey].toLowerCase(), `:root ${cssVar} must match the classic theme`);
  }
  // The tri-state mode plumbing: Off -> Best -> Engines, no legacy boolean left behind.
  assert.ok(!/arrowsOn/.test(appJs), "the old arrowsOn boolean must be fully replaced by arrowMode");
  assert.ok(appJs.includes("arrowMode === 'engines'") && appJs.includes("arrowMode === 'best'"), "drawArrows must gate on the tri-state arrowMode");
  assert.ok(appJs.includes("function setArrowMode"), "setArrowMode drives the button's aria state");
  assert.ok(appJs.includes("renderEngineBand"), "the engine colour band renders with the coach view");
  assert.ok(appJs.includes("'__votes__'"), "the top-bar Engine picker exposes the all-engines coach view");
  // A translucent hot state is fine in the vivid system; it must not stack extra opacity on an arrow.
  const hot = cssRule(".arrows polygon.hot");
  assert.ok(!/opacity\s*:\s*0?\.[0-9]/.test(hot), "the hot state must not dim arrows");
});
