(function (root) {
  // Board-overlay contrast law (test/ui-contrast.test.js verifies every claim below against the COMPOSITED
  // colour on both square colours): each theme's dark square caps a dark overlay's luminance at
  // Lmax = (Ldark+0.05)/3 - 0.05, so every overlay family lives in the legal band [3:1, Cmax], where
  // Cmax = (Ldark+0.05)/0.05 is the pure-black ceiling. arrowMove/arrowMove2/arrowMove3 (top-3 engine
  // lines) SPREAD that band evenly in log contrast — rank 1 at 0.93*Cmax (near-black = strongest move),
  // rank 3 at ~3.15:1 (the lightest legal tint = weakest), rank 2 at the geometric mean — so the
  // darker-equals-stronger ladder reads at a glance: adjacent rungs step >=1.10:1 in every theme. (The
  // previous three tints crowded the top of the band at 1.03-1.15:1 per step and were indistinguishable;
  // the pre-v4 opacity ladder read well but composited under 3:1 on every rung, so neither was shippable.)
  // arrowEng1..5 colour the five-engine coach view — one hue per registry engine (1 Stockfish blue,
  // 2 Berserk amber, 3 Obsidian magenta, 4 PlentyChess cyan, 5 Viridithas green): max-chroma hues at
  // L <= 0.92*Lmax, pairwise hue gaps >=50 degrees. Midnight's low cap flattens hue discrimination, so
  // there the registry WIDTH ladder (10..6) and the hover legend carry identification; hue is the third
  // cue. arrowThreat (threat arrows, check disc) stays a dark red >=100 degrees from every green rung;
  // target (legal-move dot, capture ring) is unchanged.
  const themes = {
    classic: { name: 'Classic walnut', bg:'#24231f', surface:'#2f2e29', raised:'#414039', text:'#f1eee5', muted:'#c4c0b3', light:'#ede2cd', dark:'#a78162', accent:'#ded5b9', ink:'#24251f', danger:'#f1b4a1', selected:'#d8d899', arrowMove:'#040f06', arrowMove2:'#04300c', arrowMove3:'#044613', arrowThreat:'#4d2019', target:'#221a12', arrowEng1:'#3000c2', arrowEng2:'#4d3900', arrowEng3:'#710068', arrowEng4:'#004061', arrowEng5:'#004617' },
    forest: { name: 'Tournament green', bg:'#172c27', surface:'#203831', raised:'#29443b', text:'#edf2e9', muted:'#a8c0b4', light:'#e4e9d5', dark:'#779584', accent:'#cedfba', ink:'#14291f', danger:'#f0b4a5', selected:'#c8d8a4', arrowMove:'#020f07', arrowMove2:'#023310', arrowMove3:'#024c17', arrowThreat:'#52221a', target:'#0f2016', arrowEng1:'#3400cf', arrowEng2:'#523d00', arrowEng3:'#79006f', arrowEng4:'#004567', arrowEng5:'#004b19' },
    ocean: { name: 'Ocean blue', bg:'#18262c', surface:'#21343e', raised:'#304a58', text:'#edf4f5', muted:'#b2cbd5', light:'#dce8e7', dark:'#668d9c', accent:'#c7dde6', ink:'#15282e', danger:'#f0b6a9', selected:'#b8d2bf', arrowMove:'#020f0c', arrowMove2:'#022d26', arrowMove3:'#034339', arrowThreat:'#4c1f1c', target:'#10201f', arrowEng1:'#3000be', arrowEng2:'#4b3800', arrowEng3:'#6f0066', arrowEng4:'#003f5e', arrowEng5:'#004517' },
    ivory: { name: 'Daylight', bg:'#f7f6f0', surface:'#fffefa', raised:'#e5e8de', text:'#222d27', muted:'#526056', light:'#eeeade', dark:'#889b83', accent:'#354f40', ink:'#ffffff', danger:'#91382d', selected:'#c3d29a', lightMode:true, arrowMove:'#050f03', arrowMove2:'#06370c', arrowMove3:'#085214', arrowThreat:'#5d241d', target:'#23291f', arrowEng1:'#3800e0', arrowEng2:'#5a4300', arrowEng3:'#830079', arrowEng4:'#004b71', arrowEng5:'#00521b' },
    midnight: { name: 'High contrast', bg:'#141414', surface:'#222222', raised:'#373737', text:'#ffffff', muted:'#c8c8c8', light:'#f2f2ed', dark:'#717171', accent:'#e7e7de', ink:'#161616', danger:'#ffbaa7', selected:'#cbd49d', arrowMove:'#040f08', arrowMove2:'#03200c', arrowMove3:'#022c10', arrowThreat:'#33100c', target:'#0a0a0a', arrowEng1:'#210084', arrowEng2:'#312500', arrowEng3:'#4c0046', arrowEng4:'#00293e', arrowEng5:'#002e0f' },
    rosewood: { name: 'Rosewood', bg:'#291e20', surface:'#39292c', raised:'#51393e', text:'#f5eae6', muted:'#d1b9bc', light:'#ead9ce', dark:'#9d6d66', accent:'#e3c8bd', ink:'#302025', danger:'#ffc0af', selected:'#d8cb9c', arrowMove:'#040f08', arrowMove2:'#04250d', arrowMove3:'#043512', arrowThreat:'#38100d', target:'#1c1210', arrowEng1:'#27009a', arrowEng2:'#3b2c00', arrowEng3:'#590052', arrowEng4:'#00324a', arrowEng5:'#003712' },
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
