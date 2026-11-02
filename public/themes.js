(function (root) {
  // Board theme tokens. Arrows are NOT themed: they follow the reference boards (chessground's shipped
  // brushes, chess.com's game review) — saturated, global colours drawn translucent with fat shafts —
  // so the live board stays visible under the annotation and every engine's colour reads the same on
  // every theme (the constants live next to drawArrows in public/app.js). What IS themed here are the
  // essential overlays: arrowThreat doubles as the check-disc colour and target is the legal-move dot /
  // capture ring / last-move ring — both must sit at >=3:1 against BOTH square colours (WCAG 1.4.11),
  // pinned by test/ui-contrast.test.js.
  const themes = {
    classic: { name: 'Classic walnut', bg:'#24231f', surface:'#2f2e29', raised:'#414039', text:'#f1eee5', muted:'#c4c0b3', light:'#ede2cd', dark:'#a78162', accent:'#ded5b9', ink:'#24251f', danger:'#f1b4a1', selected:'#d8d899', arrowThreat:'#4d2019', target:'#221a12' },
    forest: { name: 'Tournament green', bg:'#172c27', surface:'#203831', raised:'#29443b', text:'#edf2e9', muted:'#a8c0b4', light:'#e4e9d5', dark:'#779584', accent:'#cedfba', ink:'#14291f', danger:'#f0b4a5', selected:'#c8d8a4', arrowThreat:'#52221a', target:'#0f2016' },
    ocean: { name: 'Ocean blue', bg:'#18262c', surface:'#21343e', raised:'#304a58', text:'#edf4f5', muted:'#b2cbd5', light:'#dce8e7', dark:'#668d9c', accent:'#c7dde6', ink:'#15282e', danger:'#f0b6a9', selected:'#b8d2bf', arrowThreat:'#4c1f1c', target:'#10201f' },
    ivory: { name: 'Daylight', bg:'#f7f6f0', surface:'#fffefa', raised:'#e5e8de', text:'#222d27', muted:'#526056', light:'#eeeade', dark:'#889b83', accent:'#354f40', ink:'#ffffff', danger:'#91382d', selected:'#c3d29a', lightMode:true, arrowThreat:'#5d241d', target:'#23291f' },
    midnight: { name: 'High contrast', bg:'#141414', surface:'#222222', raised:'#373737', text:'#ffffff', muted:'#c8c8c8', light:'#f2f2ed', dark:'#717171', accent:'#e7e7de', ink:'#161616', danger:'#ffbaa7', selected:'#cbd49d', arrowThreat:'#33100c', target:'#0a0a0a' },
    rosewood: { name: 'Rosewood', bg:'#291e20', surface:'#39292c', raised:'#51393e', text:'#f5eae6', muted:'#d1b9bc', light:'#ead9ce', dark:'#9d6d66', accent:'#e3c8bd', ink:'#302025', danger:'#ffc0af', selected:'#d8cb9c', arrowThreat:'#38100d', target:'#1c1210' },
  };
  function contrastInk(hex) {
    const values = hex.slice(1).match(/../g).map((x) => parseInt(x,16)/255).map((x) => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
    const luminance = values.reduce((s,x,i) => s+x*[.2126,.7152,.0722][i],0);
    return (luminance+.05)/.055 > 1.02/(luminance+.05) ? '#101710' : '#fffef8';
  }
  for (const theme of Object.values(themes)) {
    theme.coordLight = contrastInk(theme.light);
    theme.coordDark = contrastInk(theme.dark);
  }
  if (typeof module !== 'undefined') module.exports = themes;
  else root.CHESS_THEMES = themes;
})(typeof window === 'undefined' ? globalThis : window);
