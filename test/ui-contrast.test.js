// Pins the WCAG contrast floors for the brilliant badge family and the board-overlay layer
// (finding 3 + polish (a)): badge glyphs >=3:1 against their disc (1.4.11 graphics), the
// brilliant-count text >=4.5:1 (it is 11px text), and each theme's arrows / legal-move dot /
// capture ring >=3:1 against BOTH square colours. Sources are parsed - not redeclared - so a
// retuned hex in app.js, style.css, themes.js or lib/archive.js fails here instead of shipping.
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

test("every theme's arrows, legal-move dot and capture ring clear 3:1 on both square colours", () => {
  for (const [key, theme] of Object.entries(themes)) {
    for (const overlay of ["arrowMove", "arrowThreat", "target"]) {
      assert.ok(/^#[0-9a-f]{6}$/i.test(theme[overlay] ?? ""), `theme ${key} is missing a ${overlay} colour`);
      for (const square of ["light", "dark"]) {
        const ratio = contrast(channels(theme[overlay]), channels(theme[square]));
        assert.ok(ratio >= 3, `${key} ${overlay} ${theme[overlay]} on ${square} ${theme[square]} is ${ratio.toFixed(2)}:1, needs 3:1`);
      }
    }
  }
});

test("overlays stay wired to the theme palette instead of hard-coded washes", () => {
  assert.equal(cssProp(cssRule(".square.target::after"), "background"), "var(--target)",
    "legal-move dot must use var(--target)");
  assert.ok(cssProp(cssRule(".square.target.capture::after"), "background").includes("var(--target)"),
    "capture ring must use var(--target)");
  assert.ok(!/target::after[^}]*rgb\(/i.test(styleCss), "target overlays must not fall back to translucent black");
  // :root carries the Classic defaults, so the no-JS first paint matches themes.classic exactly.
  const root = cssRule(":root");
  for (const [cssVar, themeKey] of [["--arrow-move", "arrowMove"], ["--arrow-threat", "arrowThreat"], ["--target", "target"]]) {
    assert.equal(cssProp(root, cssVar)?.toLowerCase(), themes.classic[themeKey].toLowerCase(), `:root ${cssVar} must match the classic theme`);
  }
  const arrows = (appJs.match(/function drawArrows\(live\) \{[\s\S]*?\n\}/)?.[0] ?? "").replace(/\/\/.*$/gm, "");
  assert.ok(arrows.includes("theme.arrowMove") && arrows.includes("theme.arrowThreat"),
    "drawArrows must colour arrows from the active theme");
  assert.ok(!/#[0-9a-f]{6}/i.test(arrows), "drawArrows must not hard-code arrow colours");
  // A translucent hot state would re-composite the fill below 3:1; emphasis must stay opaque.
  const hot = cssRule(".arrows polygon.hot");
  assert.ok(!/\bopacity\s*:/.test(hot) || parseFloat(hot.match(/opacity\s*:\s*([\d.]+)/)[1]) >= 1,
    "the hot state must not dim arrows below full opacity");
});
