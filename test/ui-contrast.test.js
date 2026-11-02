// Pins the WCAG contrast floors for the brilliant badge family and the board-overlay layer: badge glyphs >=3:1
// against their disc (1.4.11 graphics), the brilliant-count text >=4.5:1 (it is 11px text), and every board
// overlay — the three move-arrow tints (as a rank LADDER, not just three colours), threat arrows, the five
// per-engine coach-view hues, the legal-move dot / capture ring — >=3:1 against BOTH square colours, measured
// as COMPOSITED (alpha over the square, the rendered colour) with the alpha parsed from the source. Sources
// are parsed - not redeclared - so a retuned hex or a reintroduced translucency in app.js, style.css or
// themes.js fails here instead of shipping. The five-engine offset planner (ENGINE_ARROWS) is executed
// headlessly: agreeing engines must spread without any arrowhead leaving the 0..800 board.
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

// drawArrows is the only place arrow colours reach the board. Its arrow() call sites carry the rendered
// opacity as numeric literals; the engines branch draws its polygons with no opacity attribute (opaque).
const drawArrowsBody = () => (appJs.match(/function drawArrows\(live, sweepLive\) \{[\s\S]*?\n\}/)?.[0] ?? "").replace(/\/\/.*$/gm, "");

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

test("arrow opacities are pinned to opaque literals (the ladder is tint-based, blend-model independent)", () => {
  const body = drawArrowsBody();
  assert.ok(body, "drawArrows(live, sweepLive) not found in public/app.js");
  const calls = [...body.matchAll(/arrow\(([^)]*)\)/g)].map((m) => m[1].split(",").map((part) => part.trim()));
  assert.ok(calls.length >= 2, "expected the suggestion and threat arrow call sites in drawArrows");
  for (const args of calls) {
    const opacity = Number(args[3]);
    assert.ok(Number.isFinite(opacity) && opacity === 1,
      `drawArrows must draw arrows at opacity 1 (got '${args[3]}'): a translucent arrow re-composites below the 3:1 floor in one blend model or the other`);
  }
  const enginesTemplate = appJs.match(/content = ENGINE_ARROWS\.plan\([\s\S]*?\.join\(''\);/)?.[0] ?? "";
  assert.ok(enginesTemplate, "the engines branch of drawArrows was not found");
  assert.ok(!enginesTemplate.includes("opacity"), "engine arrows must render opaque (no opacity attribute)");
});

test("every overlay clears 3:1 COMPOSITED on both square colours in every theme", () => {
  for (const [key, theme] of Object.entries(themes)) {
    // Opaque (alpha 1, pinned by the test above) — composited === raw today; the composite call keeps the
    // contract honest the day anyone reintroduces translucency.
    for (const overlay of ["arrowMove", "arrowMove2", "arrowMove3", "arrowThreat", "arrowEng1", "arrowEng2", "arrowEng3", "arrowEng4", "arrowEng5", "target"]) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(theme[overlay] ?? ""), `theme ${key} is missing a ${overlay} colour`);
      for (const square of ["light", "dark"]) {
        const rendered = hexOf(composite(theme[overlay], 1, theme[square]));
        const ratio = contrast(channels(rendered), channels(theme[square]));
        assert.ok(ratio >= 3, `${key} ${overlay} ${theme[overlay]} on ${square} ${theme[square]} composites to ${rendered} at ${ratio.toFixed(2)}:1, needs 3:1`);
      }
    }
  }
});

test("the move tints ladder across the whole legal band with perceptible steps (darker = stronger)", () => {
  // The rank-3 restoration: each theme's dark square caps overlay contrast at Cmax = (Ldark+0.05)/0.05; the
  // three rungs must SPREAD that band (rank 1 near the ceiling, rank 3 at the 3:1 floor) so adjacent rungs
  // step >=1.10:1 — the previous tints stepped 1.03-1.15:1 and rank was unreadable (audit finding).
  for (const [key, theme] of Object.entries(themes)) {
    const darkLum = luminance(channels(theme.dark));
    const cMax = (darkLum + 0.05) / 0.05;
    const rungs = [theme.arrowMove, theme.arrowMove2, theme.arrowMove3].map((hex) => hexOf(composite(hex, 1, theme.dark)));
    const ratios = rungs.map((hex) => contrast(channels(hex), channels(theme.dark)));
    assert.ok(ratios[0] >= 0.85 * cMax, `${key}: rank 1 uses only ${ratios[0].toFixed(2)}:1 of a ${cMax.toFixed(2)}:1 ceiling — the dark end of the band must stay used`);
    assert.ok(ratios.every((r) => r >= 3), `${key}: every rung must clear 3:1 on the binding dark square`);
    const step12 = ratios[0] / ratios[1], step23 = ratios[1] / ratios[2];
    assert.ok(step12 >= 1.10 && step23 >= 1.10, `${key}: adjacent rung steps ${step12.toFixed(2)} and ${step23.toFixed(2)} must each be >=1.10 — the shade ladder is the encoding`);
    const climb = rungs.map((hex) => luminance(channels(hex)));
    assert.ok(climb[0] < climb[1] && climb[1] < climb[2], `${key}: rung luminance must climb by rank`);
  }
});

test("threats, engine hues and rungs are separated by hue, never by lightness alone", () => {
  for (const [key, theme] of Object.entries(themes)) {
    for (const rung of ["arrowMove", "arrowMove2", "arrowMove3"]) {
      assert.ok(hueGap(theme.arrowThreat, theme[rung]) >= 30,
        `${key}: threat ${theme.arrowThreat} vs ${rung} ${theme[rung]} is ${hueGap(theme.arrowThreat, theme[rung]).toFixed(0)}° apart, needs 30°`);
    }
    const engineHues = ["arrowEng1", "arrowEng2", "arrowEng3", "arrowEng4", "arrowEng5"].map((token) => theme[token]);
    const minPair = key === "midnight" ? 45 : 40;
    for (let i = 0; i < engineHues.length; i++) {
      assert.ok(hueGap(theme.arrowThreat, engineHues[i]) >= 30, `${key}: engine hue ${engineHues[i]} sits within 30° of threat red`);
      for (let j = i + 1; j < engineHues.length; j++) {
        assert.ok(hueGap(engineHues[i], engineHues[j]) >= minPair,
          `${key}: engine hues ${engineHues[i]} and ${engineHues[j]} are ${hueGap(engineHues[i], engineHues[j]).toFixed(0)}° apart, need ${minPair}°`);
      }
    }
    if (key === "midnight") {
      // Midnight's luminance cap (0.0217) flattens hue discrimination; every engine colour must still carry
      // real chroma (channel spread >=45) so the hue cue degrades gracefully behind the width ladder.
      for (const hex of engineHues) {
        const spread = Math.max(...channels(hex)) - Math.min(...channels(hex));
        assert.ok(spread >= 45, `midnight engine hue ${hex} has channel spread ${spread}, needs 45`);
      }
    }
  }
});

test("ENGINE_ARROWS spreads agreeing engines and never clips an arrowhead off the board", () => {
  // arrowPoints + ENGINE_ARROWS are evaluated together (the planner calls the geometry helper), the same
  // headless-extraction trick as BADGES.
  const geometry = appJs.match(/function arrowPoints\(from, to, width, proj\) \{[\s\S]*?\n\}/)?.[0];
  const planner = appJs.match(/const ENGINE_ARROWS = \(\(\) => \{[\s\S]*?\}\)\(\);/)?.[0];
  assert.ok(geometry && planner, "arrowPoints / ENGINE_ARROWS blocks not found in public/app.js");
  const { plan } = new Function(`${geometry}\n${planner}; return ENGINE_ARROWS;`)();
  const FILES = "abcdefgh";
  const proj = (sq) => [FILES.indexOf(sq[0]) * 100 + 50, (8 - +sq[1]) * 100 + 50];
  const theme = { arrowEng1: "#111111", arrowEng2: "#222222", arrowEng3: "#333333", arrowEng4: "#444444", arrowEng5: "#555555" };
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
    const polygons = plan(votes(from, to), theme, proj);
    assert.equal(polygons.length, 5, `${from}${to}: one arrow per agreeing engine`);
    inBounds(polygons);
    const lefts = polygons.map(({ points }) => Math.min(...points.map((p) => p[0]))).sort((a, b) => a - b);
    for (let i = 1; i < lefts.length; i++) {
      assert.ok(lefts[i] - lefts[i - 1] >= 2 - 1e-6, `${from}${to}: agreeing arrows must stay >=2 units apart`);
    }
  }
  // A single engine's vote draws one unshifted arrow; disagreement draws one arrow per group.
  assert.equal(plan(votes("e2", "e4").slice(0, 1), theme, proj).length, 1);
  const split = [votes("e2", "e4")[0], { ...votes("d2", "d4")[1] }];
  assert.equal(plan(split, theme, proj).length, 2);
  // Skipped and errored engines draw nothing.
  assert.equal(plan([{ engineId: "x", name: "X", skipped: "chess960" }, { engineId: "y", name: "Y", error: "boom" }], theme, proj).length, 0);
});

test("overlays stay wired to the theme palette instead of hard-coded washes", () => {
  assert.equal(cssProp(cssRule(".square.target::after"), "background"), "var(--target)",
    "legal-move dot must use var(--target)");
  assert.ok(cssProp(cssRule(".square.target.capture::after"), "background").includes("var(--target)"),
    "capture ring must use var(--target)");
  assert.ok(!/target::after[^}]*rgb\(/i.test(styleCss), "target overlays must not fall back to translucent black");
  // The check disc and the last-move ring are board overlays like the arrows: they must carry a >=3:1 theme
  // token, not a fixed wash (the old #be6959 disc measured 1.09-1.39:1 on dark squares).
  const check = cssRule(".square.check::after");
  assert.equal(cssProp(check, "background"), "var(--arrow-threat)", "the check disc must use the threat token");
  assert.ok(!/opacity\s*:/.test(check) || parseFloat(check.match(/opacity\s*:\s*([\d.]+)/)[1]) >= 1,
    "a translucent check disc would re-composite below the floor");
  const lastMove = cssRule(".square.lastmove::before");
  assert.ok(lastMove.includes("var(--target)"), "the last-move cue's contrast carrier is its var(--target) ring");
  // :root carries the Classic defaults, so the no-JS first paint matches themes.classic exactly.
  const root = cssRule(":root");
  for (const [cssVar, themeKey] of [["--arrow-move", "arrowMove"], ["--arrow-move2", "arrowMove2"], ["--arrow-move3", "arrowMove3"], ["--arrow-threat", "arrowThreat"], ["--target", "target"],
    ["--arrow-eng1", "arrowEng1"], ["--arrow-eng2", "arrowEng2"], ["--arrow-eng3", "arrowEng3"], ["--arrow-eng4", "arrowEng4"], ["--arrow-eng5", "arrowEng5"]]) {
    assert.equal(cssProp(root, cssVar)?.toLowerCase(), themes.classic[themeKey].toLowerCase(), `:root ${cssVar} must match the classic theme`);
  }
  const arrows = drawArrowsBody();
  assert.ok(["theme.arrowMove", "theme.arrowMove2", "theme.arrowMove3", "theme.arrowThreat"].every((token) => arrows.includes(token)),
    "drawArrows must colour best-line arrows from the active theme");
  assert.ok(!/#[0-9a-f]{6}/i.test(arrows), "drawArrows must not hard-code arrow colours");
  // The tri-state mode plumbing: Off -> Best -> Engines, no legacy boolean left behind.
  assert.ok(!/arrowsOn/.test(appJs), "the old arrowsOn boolean must be fully replaced by arrowMode");
  assert.ok(appJs.includes("arrowMode === 'engines'") && appJs.includes("arrowMode === 'best'"), "drawArrows must gate on the tri-state arrowMode");
  assert.ok(appJs.includes("function setArrowMode"), "setArrowMode drives the button's aria state");
  // A translucent hot state would re-composite the fill below 3:1; emphasis must stay opaque.
  const hot = cssRule(".arrows polygon.hot");
  assert.ok(!/\bopacity\s*:/.test(hot) || parseFloat(hot.match(/opacity\s*:\s*([\d.]+)/)[1]) >= 1,
    "the hot state must not dim arrows below full opacity");
});
