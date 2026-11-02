// Run with a local Chromium debugging port: node test/browser.cjs 58776
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const port = process.argv[2];
  assert(port, 'Pass the debugging port from agent-browser get cdp-url.');
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const target = tabs.find((tab) => tab.type === 'page' && /127\.0\.0\.1:4655/.test(tab.url));
  assert(target, 'Open the chess app before running browser verification.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, {once:true}));
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', ({data}) => {
    const message = JSON.parse(data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
  });
  const send = (method,params={}) => new Promise((resolve,reject) => {
    const id=++sequence, timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out`));},30000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression,ms=15000) => {
    const end=Date.now()+ms;
    while(Date.now()<end) { if(await evaluate(expression)) return; await delay(70); }
    throw new Error(`Condition failed: ${expression}`);
  };
  const point = (selector) => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  let held = false;
  const mouse = async (type,p) => {
    if(type==='mousePressed') held=true;
    if(type==='mouseReleased') held=false;
    await send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'&&!held?'none':'left',buttons:held?1:0,clickCount:type==='mouseMoved'?0:1});
    await delay(25);
  };
  const click = async (selector) => { const p=await point(selector);await mouse('mouseMoved',p);await mouse('mousePressed',p);await mouse('mouseReleased',p);await delay(70); };
  const sq = (square) => `.square[data-square="${square}"]`;
  const drag = async (from,to,outside=false) => {
    const a=await point(sq(from)),b=outside?{x:5,y:5}:await point(sq(to));
    await mouse('mouseMoved',a);await mouse('mousePressed',a);
    for(let i=1;i<=8;i++) { await mouse('mouseMoved',{x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8});await delay(12); }
    if(!outside) assert.equal(await evaluate(`getComputedStyle(ghost).display`),'grid','held piece follows the pointer');
    await mouse('mouseReleased',b);
  };
  const key = async (key,code=key) => {
    const windowsVirtualKeyCode={Enter:13,Escape:27,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40}[key] || 0;
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code,windowsVirtualKeyCode});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode}); await delay(35);
  };
  const reset = async () => { await evaluate(`mutate('new')`); await wait(`!busy && game.moveLog.length===0`); };
  const screenshot = async (name,full=false) => {
    await evaluate(`document.fonts.ready`);
    const metrics=await send('Page.getLayoutMetrics');
    const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:full,...(full?{clip:{x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1}}:{})});
    await fs.writeFile(path.join('.impeccable','review',name),Buffer.from(image.data,'base64'));
  };
  const captureViewports = async () => {
    await wait(`analysis?.phase==='ready' && document.querySelector('.line .play')`,25000);
    await wait(`document.querySelector('#toast').classList.contains('hidden')`);
    assert.equal(await evaluate(`document.querySelector('#speed').value`),String(await evaluate('game.analysisMs')),'analysis time remains truthful after reload');
    for(const [width,height,name] of [[390,844,'mobile.png'],[1440,900,'desktop.png'],[1254,900,'user-1254.png'],[320,740,'mobile-320.png']]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate('window.scrollTo(0,0)');await delay(150);
      assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`no overflow at ${width}px`);
      assert.equal(await evaluate(`[...document.images].some(i=>!i.complete||!i.naturalWidth)`),false);
      await screenshot(name,width<761);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  };
  await fs.mkdir('.impeccable/review',{recursive:true});
  const checks=[];
  try {
    await send('Page.enable');
    const loaded = new Promise((resolve)=>socket.addEventListener('message',({data})=>{if(JSON.parse(data).method==='Page.loadEventFired')resolve();}));
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.reload',{ignoreCache:true}); await loaded; await wait(`typeof game!=='undefined' && game && !busy`);
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await delay(300);
    if(process.argv.includes('--capture-only')) { await captureViewports();console.log('Recaptured all four viewports.');return; }
    await reset();
    assert(await evaluate(`document.querySelector('${sq('a1')}').classList.contains('dark') && document.querySelector('${sq('h1')}').classList.contains('light')`));
    await drag('e2','e4'); await wait(`game.moveLog.length===1 && !busy`);
    assert.equal(await evaluate(`game.moveLog[0].san`),'e4');
    await click(sq('g1'));await click(sq('f3'));assert.equal(await evaluate('game.moveLog.length'),1);
    await drag('e7','e5',true);assert.equal(await evaluate('game.moveLog.length'),1);assert.equal(await evaluate('gesture'),null);
    checks.push('mouse drag, held-piece feedback, outside-board cancellation, square orientation');

    await click(sq('e7'));await click(sq('e5'));await wait(`game.moveLog.length===2 && !busy`);
    assert.equal(await evaluate('game.moveLog[1].san'),'e5');
    await click('#flip');assert.equal(await evaluate(`document.querySelector('.square').dataset.square`),'h1');
    await drag('g1','f3');await wait('game.moveLog.length===3 && !busy');
    await click('#flip');checks.push('click-to-move, flipped dragging and orientation');

    await click('#navFirst');assert.equal(await evaluate('viewIndex'),0);
    await click('#navNext');assert.equal(await evaluate('viewIndex'),1);
    await click('#navLast');assert.equal(await evaluate('viewIndex'),3);
    await click('#navPrev');assert.equal(await evaluate('viewIndex'),2);
    await click('.mv[data-ply="1"]');await drag('c7','c5');await wait('game.moveLog.length===2 && !busy');
    assert.equal(await evaluate('game.moveLog[1].san'),'c5');await click('#undo');await wait('game.moveLog.length===1 && !busy');
    checks.push('all history buttons, clickable notation, branching, undo');

    await reset();await evaluate('board.focus()');await key('Enter');await key('ArrowUp');await key('ArrowUp');await key('Enter');
    await wait('game.moveLog.length===1 && !busy');assert.equal(await evaluate('game.moveLog[0].san'),'e4');
    checks.push('keyboard selection and move entry');

    await reset();
    for(const u of 'a2a4 h7h5 a4a5 h5h4 a5a6 h4h3 a6b7 h3g2'.split(' ')) await evaluate(`submitMove('${u.slice(0,2)}','${u.slice(2,4)}')`);
    await wait('game.moveLog.length===8 && !busy');
    await click(sq('b7'));await click(sq('a8'));await wait(`document.querySelector('#promo').open`);
    await screenshot('promotion.png');await key('Escape');await wait('!promoting');assert.equal(await evaluate('game.moveLog.length'),8);
    await click(sq('b7'));await click(sq('a8'));await wait(`document.querySelector('#promo').open`);await click('#promoChoices button:last-child');
    await wait('game.moveLog.length===9 && !busy');assert.equal(await evaluate('game.moveLog[8].uci'),'b7a8n');
    checks.push('promotion focus, Escape cancellation and knight underpromotion');

    await reset();await click(sq('d1'));await click(sq('e8'));await wait('!busy');
    assert.equal(await evaluate('game.moveLog.length'),0);assert.equal(await evaluate(`pieces.get('d1').dataset.code`),'Q');
    assert(await evaluate(`!document.querySelector('#toast').classList.contains('hidden')`));
    checks.push('rejected king capture restores board and displays recovery message');

    await evaluate(`submitMove('e2','e4')`);await wait('game.moveLog.length===1 && !busy');
    await click('#new');await wait(`document.querySelector('#newDialog').open`);await click('#newCancel');assert.equal(await evaluate('game.moveLog.length'),1);
    await click('#new');await click('#newConfirm');await wait('game.moveLog.length===0 && !busy');
    checks.push('new-position confirmation and cancellation');

    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await evaluate('window.scrollTo(0,0)');
    const a=await point(sq('e2')),b=await point(sq('e4'));
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...a,id:1}]});
    for(let i=1;i<=8;i++) {await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/8,y:a.y+(b.y-a.y)*i/8,id:1}]});await delay(16);}
    assert.equal(await evaluate('getComputedStyle(ghost).display'),'grid');
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await wait('game.moveLog.length===1 && !busy');
    const c=await point(sq('e7'));
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...c,id:2}]});
    await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:c.x,y:c.y+45,id:2}]});
    await send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
    await wait('gesture===null');
    assert.equal(await evaluate('gesture'),null);assert.equal(await evaluate('game.moveLog.length'),1);
    checks.push('Chromium synthesized touch drag and interrupted-touch recovery');
    await send('Emulation.setTouchEmulationEnabled',{enabled:false});

    await evaluate(`submitMove('e7','e5')`);await evaluate(`submitMove('g1','f3')`);await evaluate(`submitMove('b8','c6')`);await evaluate(`submitMove('f1','c4')`);
    await wait(`analysis?.fen===currentFen() && analysis.phase==='ready'`,25000);
    assert((await evaluate('analysis.depth'))>0);assert.equal(await evaluate('analysis.lines.length'),3);
    // The Arrows button is a tri-state (Off -> Best -> Engines): off hides everything, best restores the
    // ranked ladder, engines swaps in one first-choice arrow per registry engine (a real sequential sweep).
    await click('#coach');assert.equal(await evaluate('arrowMode'),'engines');
    await click('#coach');assert.equal(await evaluate(`document.querySelectorAll('#arrows polygon').length`),0,'off hides every arrow');
    await click('#coach');assert((await evaluate(`document.querySelectorAll('#arrows polygon').length`))>0,'best draws the ranked ladder');
    await click('#coach');await wait(`analysis?.sweep?.phase==='ready'`,60000);
    assert.equal(await evaluate(`document.querySelectorAll('#arrows polygon').length`),await evaluate('engineRegistry.engines.length'),'one arrow per engine answered');
    await click('#coach');await click('#coach');
    await evaluate(`document.querySelector('#speed').value='900';document.querySelector('#speed').onchange()`);
    await wait(`fetch('/api/analysis').then(r=>r.json()).then(d=>d.phase==='ready')`,25000);
    await wait(`analysis.phase==='ready' && document.querySelector('.line .play')`,25000);
    checks.push('real Stockfish analysis, three variations, arrow toggle, analysis-time setting');
    await send('Network.enable');
    await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await evaluate(`submitMove('g8','f6')`);
    assert.equal(await evaluate('game.moveLog.length'),5);
    assert.equal(await evaluate(`pieces.has('g8') && !pieces.has('f6')`),true);
    assert.equal(await evaluate('online'),false);
    await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await evaluate('pollAnalysis()');
    await wait(`online && analysis.phase==='ready' && document.querySelector('.line .play')`);
    checks.push('offline move rollback, visible connection error and automatic recovery');
    await wait(`document.querySelector('#toast').classList.contains('hidden')`);
    await captureViewports();
    checks.push('1440, 1254, 390 and 320px layouts, no horizontal overflow or missing images');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.piece')).transitionDuration`),'0s');
    await send('Emulation.setEmulatedMedia',{features:[]});checks.push('reduced-motion alternatives');
    await wait(`document.querySelector('.line .play') && analysis.phase==='ready'`,25000);
    await click('.line .play');await wait('game.moveLog.length===6 && !busy');checks.push('engine variation play control');
    await fs.writeFile('.impeccable/review/browser-results.json',JSON.stringify({engine:'Chromium',touch:'CDP Input.dispatchTouchEvent; physical hardware untested',checks},null,2));
    console.log(JSON.stringify({passed:checks.length,checks},null,2));
  } finally { await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:0,y:0,button:'left',buttons:0,clickCount:1}); socket.close(); }
}
run().catch((error)=>{console.error(error);process.exitCode=1;});
