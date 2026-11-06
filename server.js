const express = require('express');
const { exec, spawn } = require('node:child_process');
const { randomInt, randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const rules = require('./lib/rules');
const { Engine, SEARCH_CANCELLED, PRIORITY } = require('./lib/engine');
const { createGovernor } = require('./lib/governor');
const { assessMove, hint, expectedPoints, moveIdea } = require('./lib/tutor');
const { openingAt, guideAt } = require('./lib/opening-guide');
const { createArchive } = require('./lib/archive');
const { createOnline } = require('./lib/online');
const { createPuzzles } = require('./lib/puzzles');
const THEMES = require('./public/themes');
const OPENINGS = require('./data/openings.json');
const PORT = process.env.PORT || 4655;
// Engine registry: entries whose executable is missing are skipped, and a malformed or empty engines.json falls back
// to the built-in Stockfish entry. STOCKFISH_EXE still overrides everything (spawn precedence lives in lib/engine.js).
const BUILT_IN_ENGINE={id:'stockfish',name:'Stockfish 19',path:path.join(__dirname,'stockfish','stockfish-windows-x86-64-universal.exe'),chess960:true,elo:true,multipv:true};
function loadEngines() {
  try {
    const loaded=[];
    for(const entry of JSON.parse(fs.readFileSync(path.join(__dirname,'engines.json'),'utf8'))) {
      const resolved={...entry,name:entry.name||entry.id,chess960:Boolean(entry.chess960),elo:Boolean(entry.elo),multipv:Boolean(entry.multipv),path:path.isAbsolute(entry.path)?entry.path:path.join(__dirname,entry.path)};
      if(fs.existsSync(resolved.path))loaded.push(resolved);
    }
    if(loaded.length)return loaded;
    console.warn('[engines] No engine executable found; using the built-in Stockfish.');
  }catch(error){console.warn(`[engines] engines.json could not be read (${error.message}); using the built-in Stockfish.`);}
  return [{...BUILT_IN_ENGINE}];
}
const ENGINES=loadEngines();

// variety: free-play Stockfish picks randomly from its top moves instead of always playing the best (opt-in).
// powerMode and engineId are session-level settings owned by /api/settings; they tune the governor, not the game.
// onlineFeatures is the same kind of session switch and defaults to OFF: the app is local-first and only talks
// to lichess after the user opts in.
let settings = {mode:'free',variant:'standard',humanColor:'w',engineSide:null,variety:false,strength:50,seed:518,theme:'classic',analysisMs:1600,flipped:false,powerMode:'balanced',engineId:ENGINES[0].id,onlineFeatures:false};
// Unifying invariant (mirrored in lib/engine.js): any path that cuts an analysis search short must bump
// analysisTicket in the SAME synchronous turn — the app's own move flow already does this (the bump in
// scheduleAnalysis, engine.interrupt() right after), and every new stop path (preempt, pause, settings, engine
// switch) reuses that pairing so a cut-short search can never write the cache or set an error phase.
const governor=createGovernor({mode:settings.powerMode,preempt:()=>{scheduleAnalysis(tailPly());stopSweep();}});
const currentEngine=()=>ENGINES.find(entry=>entry.id===settings.engineId)||ENGINES[0];
// Engines are used wherever their probed capabilities allow; Stockfish fills any gap and the UI is told why.
// Only Stockfish has UCI_Elo (1320-2800).
function pickEngines(chosen,game=settings) {
  const calibrated=ENGINES.find(entry=>entry.id==='stockfish')||ENGINES[0];
  const notices=[];
  let analysis=chosen;
  if(!chosen.multipv){analysis=calibrated;notices.push(`${chosen.name} reports one line only, so Stockfish analyses and grades this game.`);}
  else if(game.variant==='chess960'&&!chosen.chess960){analysis=calibrated;notices.push(`${chosen.name} does not support Chess960, so Stockfish analyses this game.`);}
  let playing=chosen;
  if(game.variant==='chess960'&&!chosen.chess960){playing=calibrated;notices.push(`${chosen.name} does not support Chess960, so Stockfish plays this game.`);}
  else if(game.mode==='engine'&&game.strength<100&&!chosen.elo){playing=calibrated;notices.push(`${chosen.name} has no Elo calibration, so Stockfish plays this limited-strength game.`);}
  return {analysis,playing,notices};
}
let engineNotices=pickEngines(currentEngine()).notices;
const {budgets,hashBudgets}=governor;
const engine = new Engine({threads:budgets.analysis,hash:hashBudgets.analysis,exe:currentEngine().path,gate:()=>governor.acquire('analysis')});
const playingEngine = new Engine({threads:budgets.playing,hash:hashBudgets.playing,exe:currentEngine().path,gate:()=>governor.acquire('playing')});
// The deep whole-game review runs on its own process so browsing the game never interrupts its long searches; it
// never takes the interactive slot, it is only thread-capped and runs at the mode's deep OS priority.
const reviewEngine = new Engine({threads:budgets.deep,hash:hashBudgets.deep,exe:currentEngine().path,priority:PRIORITY[governor.deepPriority]});
// The engine comparison ("Engines" arrow mode): one Engine per registry entry. Every sweep ask is gated
// 'analysis' on the SAME interactive slot, so coach engines never search in parallel with each other or with live
// analysis, and a game reply preempts them exactly like an analysis search. Hash stays small — a 300 ms ask
// cannot fill more, and the live processes stay memory-bounded on the Surface budget.
const coachEngines=ENGINES.map(entry=>new Engine({threads:budgets.analysis,hash:64,exe:entry.path,gate:()=>governor.acquire('analysis')}));
const archive = createArchive(process.env.CHESS_ARCHIVE_DIR || path.join(__dirname,'Brilliant Moves'));
// Online lookups cache under .cache/online (gitignored); the module only fetches after a route has checked
// settings.onlineFeatures and the current-game FEN rule below, so nothing here can go online on its own.
const online = createOnline({ cacheDir: process.env.CHESS_ONLINE_CACHE_DIR || path.join(__dirname,'.cache','online') });
const puzzles = createPuzzles({ cacheDir: process.env.CHESS_PUZZLE_CACHE_DIR || path.join(__dirname,'.cache','puzzles') });
// Keep the existing search-budget distribution; replies commit as soon as the search finishes.
const timing = {thinkTime:()=>randomInt(800,9801),pick:(count)=>randomInt(0,Math.min(count,randomInt(4,6)))};
let gameId=randomUUID(), revision=0, fens=[rules.startFen()], moveLog=[], annotations=[], evalHist=[];
let reviews=[], reviewAll=false, cache=new Map(), analysisTicket=0, computerTicket=0;
// Free play: after a takeback Stockfish waits, so its move can really be taken back. Any move you make, or "Let Stockfish play", resumes it.
let enginePaused=false;
// Visibility leases are renewed by existing polls. Pause only when every tracked tab is hidden.
const analysisTabs=new Map();
const PAUSE_TTL=10*60*1000;
const analysisPaused=()=>analysisTabs.size>0 && [...analysisTabs.values()].every(entry=>entry.hidden);
function prunePausedTabs(now=Date.now()){for(const [tab,entry] of analysisTabs)if(now-entry.seen>PAUSE_TTL)analysisTabs.delete(tab);}
// Deep review: depth 20, the user's chosen depth (on this laptop about 3–16 s per position; depth 22 measured 6–51 s). Capped at 20 s each.
const DEEP={depth:20,ms:20000};
let deepJob=0, deep={active:false,startedAt:0};
const isDeep=(entry)=>Boolean(entry) && (entry.depth>=DEEP.depth || entry.target>=DEEP.depth);
function deepProgress() {
  let done=0;
  for(let ply=0;ply<fens.length;ply++)if(isDeep(cache.get(ply)) || (ply===tailPly() && rules.status(fens).over))done++;
  return {...deep,depth:DEEP.depth,done,total:fens.length};
}
let computer={phase:'idle',error:null};
// Engine sweep: each registry engine's first choice for one position, asked strictly one at a time through
// the interactive slot. movetime-only (no depth target) — a comparative snapshot sized for the Surface budget.
const SWEEP={ms:300};
let sweepTicket=0, sweep={phase:'idle',results:[]}, sweepCache=new Map();
// Pure planner (exported for tests): engines without Chess960 are skipped with a marker — a Stockfish fallback
// would draw a second Stockfish arrow and misreport each engine's own first choice, unlike pickEngines, whose
// fallback keeps a single answer correct.
function sweepPlan(engines,nine60){return engines.map(entry=>entry.chess960||!nine60?{engineId:entry.id,name:entry.name,ask:true}:{engineId:entry.id,name:entry.name,skipped:'chess960'});}
function stopSweep(){sweepTicket++;for(const coach of coachEngines)coach.interrupt();sweep={phase:'idle',results:[]};}
function pauseSweep(){sweepTicket++;for(const coach of coachEngines)coach.interrupt();if(sweep.phase==='running')sweep={...sweep,phase:'paused'};}
function runSweep(ply) {
  if(analysisPaused())return;
  if(!Number.isInteger(ply)||ply<0||ply>tailPly())return;
  const fen=fens[ply], plan=sweepPlan(ENGINES,is960());
  const terminal=terminalReport(ply);
  if(terminal){sweep={fen,ply,phase:'ready',terminal:true,results:plan.map(entry=>entry.skipped?entry:{...entry,skipped:'terminal'})};return;}
  const cached=sweepCache.get(ply);
  if(cached&&cached.fen===fen){sweep=cached;return;}
  const ticket=++sweepTicket, id=gameId;
  sweep={fen,ply,phase:'running',results:plan};
  for(const coach of coachEngines)coach.interrupt(); // same-turn invalidation before the new asks queue
  let pending=plan.filter(entry=>entry.ask).length;
  if(!pending){sweep={...sweep,phase:'ready'};sweepCache.set(ply,sweep);return;}
  coachEngines.forEach((coach,i)=>{
    const entry=plan[i];
    if(!entry.ask)return;
    coach.exec(async()=>{
      const stale=()=>ticket!==sweepTicket||id!==gameId;
      if(stale())return;
      // Overlap binary/NNUE initialization; only actual searches need the governor's single slot.
      await coach.start();
      if(stale())return;
      const raw=await coach.go(fen,1,SWEEP.ms,optionsFor(ply));
      if(stale())return;
      const line=raw.lines[0];
      const result=line?(({uci,from,to,displayTo,san,text})=>({engineId:entry.engineId,name:entry.name,uci,from,to,displayTo,san,text,depth:raw.depth}))(mkLine(line,1,fen)):{engineId:entry.engineId,name:entry.name,error:'no move'};
      if(stale())return;
      sweep={...sweep,results:sweep.results.map((item,index)=>index===i?result:item)};
      if(--pending===0){sweep={...sweep,phase:'ready'};sweepCache.set(ply,sweep);}
    }).catch(error=>{
      if(error?.code===SEARCH_CANCELLED||ticket!==sweepTicket||id!==gameId)return;
      sweep={...sweep,results:sweep.results.map((item,index)=>index===i?{engineId:entry.engineId,name:entry.name,error:error.message}:item)};
      if(--pending===0)sweep={...sweep,phase:'ready'};
    });
  });
}
let analysis={fen:null,ply:0,phase:'idle',depth:0,nps:0,lines:[],threats:[],opening:null};
const tail=()=>fens.at(-1);
const tailPly=()=>moveLog.length;
const is960=()=>settings.variant==='chess960';

function validateSettings(input={}) {
  if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Invalid game settings.');
  const next={...settings};
  for(const key of Object.keys(next)) if(input[key]!==undefined)next[key]=input[key];
  if(!['free','engine'].includes(next.mode) || !['standard','chess960'].includes(next.variant) || !['w','b'].includes(next.humanColor) || ![null,'w','b'].includes(next.engineSide))throw new Error('Choose a valid game mode and side.');
  if(next.mode==='engine')next.engineSide=null;
  if(!Number.isInteger(next.strength) || next.strength<10 || next.strength>100 || next.strength%10)throw new Error('Engine strength must be 10% to 100% in steps of 10.');
  if(next.seed!==null && (!Number.isInteger(next.seed)||next.seed<0||next.seed>959))throw new Error('Chess960 position must be 0 to 959.');
  if(!Object.hasOwn(THEMES,next.theme))throw new Error('Choose a listed board theme.');
  if(!['full','balanced','laptop'].includes(next.powerMode))throw new Error('Choose a valid power mode.');
  if(!ENGINES.some(entry=>entry.id===next.engineId))throw new Error('Choose a listed engine.');
  if(typeof next.onlineFeatures!=='boolean')throw new Error('Online features must be on or off.');
  if(!Number.isFinite(next.analysisMs) || next.analysisMs<300 || next.analysisMs>5000 || typeof next.flipped!=='boolean' || typeof next.variety!=='boolean')throw new Error('Invalid analysis settings.');
  return next;
}
function openingName(ply=tailPly()) {
  return is960()?null:openingAt(fens,ply);
}
function positionGuide(ply) {
  const played=moveLog[ply-1];
  const plans=is960()?null:guideAt(fens[ply])?.plans??null;
  const leftPlan=!plans && ply>0 && !is960() && Boolean(guideAt(fens[ply-1])?.plans);
  return {plans,leftPlan,
    lastMove:played?`${played.san} · ${moveIdea(played,null,settings.variant)}`:null};
}
function isBook(ply) {
  if(is960())return false;
  const sequence=moveLog.slice(0,ply+1).map(move=>move.uci).join(' ');
  return Object.keys(OPENINGS).some(key=>key===sequence || key.startsWith(sequence+' '));
}
function gameInfo() {
  prunePausedTabs();
  return {id:gameId,fens,moveLog,annotations,evalHist,reviewAll,enginePaused,survival,deep:deepProgress(),revision,settings:{...settings},engineNotices,governor:{...governor.status(),paused:analysisPaused()},analysisMs:settings.analysisMs,opening:openingName(),guide:positionGuide(tailPly()),legalMoves:rules.legalMoves(tail(),settings.variant),computer,...rules.status(fens)};
}
function scoreText(cp) { return cp==null?'—':`${cp>0?'+':''}${(cp/100).toFixed(2)}`; }
function prettyLine(fen,sans) {
  let number=+fen.split(' ')[5], white=fen.split(' ')[1]==='w';
  return sans.map((san,i)=>{
    const side=i%2===0?white:!white;
    if(!side){const text=i===0?`${number}… ${san}`:san;number++;return text;}
    return `${number}. ${san}`;
  }).join(' ');
}
function mkLine(entry,rank,fen,variant=settings.variant) {
  const white=fen.split(' ')[1]==='w';
  const cp=(entry.score.type==='mate'?(entry.score.value>0?100000:-100000):entry.score.value)*(white?1:-1);
  const sans=[];let cursor=fen,first,firstMove,reply;
  for(const uci of entry.pv.slice(0,12)) {
    try {
      const request=rules.parseUciMove(cursor,uci,variant);
      const applied=rules.apply(cursor,request,variant);
      if(!first){first={...request,displayTo:applied.move.to};firstMove=applied.move;}
      else if(sans.length===1)reply=applied.move;
      sans.push(applied.move.san);cursor=applied.fen;
    }catch(_){break;}
  }
  const uci=entry.pv[0];
  const openingIdea=variant==='standard'&&guideAt(fen)?.ideas?.[uci];
  const idea=firstMove?(openingIdea||moveIdea(firstMove,reply,variant)):null;
  return {rank,uci,pv:entry.pv,from:first?.from || uci?.slice(0,2),to:first?.to || uci?.slice(2,4),displayTo:first?.displayTo,san:sans[0]||uci,sanLine:sans,pretty:prettyLine(fen,sans),whiteCp:cp,mate:entry.score.type==='mate',text:entry.score.type==='mate'?`${cp<0?'-':''}M${Math.abs(entry.score.value)}`:scoreText(cp),depth:entry.depth,wdl:entry.wdl,idea};
}
function optionsFor(ply,extra={}) {return {chess960:is960(),startFen:fens[0],moves:moveLog.slice(0,ply).map(move=>move.uci),...extra};}
function terminalReport(ply) {
  const info=rules.status(fens,ply);
  if(!info.over)return null;
  const mate=/Checkmate/i.test(info.result||'');
  return {fen:fens[ply],ply,phase:'ready',depth:0,nps:0,lines:[],threats:[],terminalCp:mate?(info.turn==='w'?-100000:100000):0,opening:openingName(ply),isTail:ply===tailPly(),result:info.result};
}
// Moves are graded with quick time-limited searches, which can fall to depth 12-13 on a busy CPU. Brilliant needs
// depth 14 (lib/tutor.js), so only a sacrifice the quick search could not confirm is re-searched to depth 16 (8 s cap).
const GRADE={depth:16,ms:8000};
async function searchPosition(ply,ticket,budget=settings.analysisMs,minDepth=0) {
  const terminal=terminalReport(ply);
  if(terminal){evalHist[ply]=terminal.terminalCp;return terminal;}
  const cached=cache.get(ply);
  // A shallow live-analysis result is re-searched for grading; a depth-targeted search that hit the cap is not repeated.
  if(cached && (cached.depth>=minDepth || cached.target>=minDepth))return cached;
  const fen=fens[ply];
  const raw=await engine.go(fen,3,budget,optionsFor(ply,{depth:minDepth||undefined,onUpdate:update=>{
    if(analysisTicket===ticket && analysis.ply===ply)analysis={...analysis,depth:update.depth,nps:update.nps,...(update.lines?.length?{lines:update.lines.map((line,i)=>mkLine(line,i+1,fen))}:{})};
  }}));
  if(analysisTicket!==ticket)return null;
  const result={fen,ply,phase:'ready',depth:raw.depth,target:minDepth,nps:raw.nps,lines:raw.lines.map((line,i)=>mkLine(line,i+1,fen)),threats:[],opening:openingName(ply),isTail:ply===tailPly()};
  cache.set(ply,result);
  if(result.lines[0])evalHist[ply]=result.lines[0].whiteCp;
  return result;
}
function archiveEntry(ply,annotation) {
  return {gameId,ply:ply+1,fen:fens[ply+1],beforeFen:fens[ply],move:{...moveLog[ply]},annotation:{...annotation},startFen:fens[0],moves:moveLog.slice(0,ply+1).map(move=>({...move})),variant:settings.variant,seed:settings.seed,theme:settings.theme,flipped:settings.flipped,pgn:rules.pgn(fens[0],moveLog.slice(0,ply+1),settings.variant)};
}
async function saveBrilliant(ply,annotation) {
  const id=gameId,entry=archiveEntry(ply,annotation);
  try {
    const saved=await archive.save(entry);
    if(id===gameId && annotations[ply]===annotation){annotation.archiveId=saved.id;delete annotation.archiveError;}
    return saved;
  }catch(error){if(id===gameId && annotations[ply]===annotation)annotation.archiveError=error.message;throw error;}
}
async function reviewMove(ply,pre,post,ticket) {
  const assess=(before,after)=>assessMove({beforeFen:fens[ply],afterFen:fens[ply+1],move:moveLog[ply],pre:before,
    post:after.lines.length?after:{...after,lines:[{whiteCp:after.terminalCp,pv:[],sanLine:[],mate:Boolean(after.terminalCp)}]},
    book:isBook(ply),opening:openingName(ply+1),variant:settings.variant});
  let annotation=assess(pre,post);
  // Only a possible sacrifice that the quick search was too shallow to confirm gets the slow, deeper search.
  if(annotation.needsDepth && ticket!==undefined) {
    const deepPre=await searchPosition(ply,ticket,GRADE.ms,GRADE.depth);if(!deepPre)return;
    const deepPost=await searchPosition(ply+1,ticket,GRADE.ms,GRADE.depth);if(!deepPost)return;
    annotation=assess(deepPre,deepPost);
  }
  annotations[ply]=annotation;
  // The collection is for the player's own finds, not Stockfish's replies.
  if(annotation.type==='brilliant' && !moveLog[ply].engine)try{await saveBrilliant(ply,annotation);}catch(error){console.error('[archive]',error.message);}
}
function scheduleAnalysis(ply=tailPly(),{fresh=false}={}) {
  if(analysisPaused())return;
  if(!Number.isInteger(ply)||ply<0||ply>tailPly())return;
  const ticket=++analysisTicket, id=gameId, fen=fens[ply];
  if(fresh)cache.delete(ply);
  const guide=positionGuide(ply);
  analysis={fen,ply,phase:'thinking',depth:0,nps:0,lines:[],threats:[],opening:openingName(ply),guide,isTail:ply===tailPly()};
  engine.interrupt();
  engine.exec(async()=>{
    const stale=()=>ticket!==analysisTicket || id!==gameId;
    if(stale())return;
    const result=await searchPosition(ply,ticket);if(!result||stale())return;
    analysis={...result,guide};
    const status=rules.status(fens,ply);
    if(!status.over && !status.inCheck) {
      const parts=fen.split(' ');parts[1]=parts[1]==='w'?'b':'w';parts[3]='-';
      const passed=parts.join(' ');
      analysis={...analysis,phase:'threats'};
      try {
        const raw=await engine.go(passed,2,350,{chess960:is960()});
        if(!stale())analysis={...analysis,phase:'ready',threats:raw.lines.map((line,i)=>mkLine(line,i+1,passed))};
      }catch(error){if(!stale())analysis={...analysis,phase:'ready',threats:[]};}
    }
    // The displayed position gets suggestions before historical grading takes the shared engine.
    for(const index of [...reviews]) {
      if(stale())return;
      if(!moveLog[index] || annotations[index]?.type!=='pending'){reviews=reviews.filter(value=>value!==index);continue;}
      const pre=await searchPosition(index,ticket,Math.max(1200,settings.analysisMs));if(!pre||stale())return;
      const post=await searchPosition(index+1,ticket,Math.max(1200,settings.analysisMs));if(!post||stale())return;
      await reviewMove(index,pre,post,ticket);if(stale())return;
      reviews=reviews.filter(value=>value!==index);
    }
    // A game review also needs every position evaluated, including book moves that were never searched.
    // A running deep review fills every position itself, so it keeps the CPU.
    if(reviewAll && !deep.active)for(let index=0;index<=tailPly();index++) {
      if(stale())return;
      if(evalHist[index]==null && !await searchPosition(index,ticket,Math.max(1200,settings.analysisMs)))return;
    }
  }).catch(error=>{if(ticket===analysisTicket && id===gameId)analysis={...analysis,phase:'error',error:error.message,lines:[],threats:[]};});
}
function stopComputer(){computerTicket++;playingEngine.interrupt();computer={phase:'idle',error:null};}
// 10%–90% map evenly onto Stockfish's calibrated 1320–2800 Elo; 100% is unlimited. Mirrored in public/app.js.
const eloFor=(strength)=>strength>=100?null:Math.round(1320+(strength-10)*18.5);
// Random top-5: a forced mate (for or against Stockfish) is always played; otherwise one of the top moves at random.
function varietyPick(lines) {
  const best=lines[0];
  return !best || best.score.type==='mate' ? best : lines[timing.pick(lines.length)];
}
// Survival mode (Random top-5 only): once Stockfish's own eval falls to -3 pawns, or it is being mated, it plays at
// full strength until it climbs back above -1.5. Scores are from Stockfish's side.
const SURVIVAL={enter:-300,exit:-150};
let survival=false;
function updateSurvival(line) {
  if(!line)return;
  const cp=line.score.type==='mate'?Math.sign(line.score.value)*100000:line.score.value;
  if(cp<=SURVIVAL.enter)survival=true;
  else if(cp>=SURVIVAL.exit)survival=false;
}
const computerColor=()=>settings.mode==='engine'?(settings.humanColor==='w'?'b':'w'):settings.engineSide;
function scheduleComputer() {
  const side=computerColor(), info=rules.status(fens);
  if(!side || info.over || info.turn!==side || (settings.mode==='free' && enginePaused))return;
  const ticket=++computerTicket, id=gameId, version=revision, ply=tailPly(),fen=tail();
  const stale=()=>ticket!==computerTicket || id!==gameId || version!==revision;
  const free=settings.mode==='free', budget=free?timing.thinkTime():0;
  computer={phase:'thinking',error:null};
  playingEngine.exec(async()=>{
    if(stale())return null;
    if(free) {
      const think=Math.min(3000,Math.max(500,budget));
      if(!settings.variety)return playingEngine.go(fen,1,think,optionsFor(ply,{skill:20}));
      // Survival keeps its longer single-line search budget.
      if(survival) {
        const raw=await playingEngine.go(fen,1,Math.max(2000,budget),optionsFor(ply,{skill:20}));
        updateSurvival(raw.lines[0]);
        return raw;
      }
      const raw=await playingEngine.go(fen,5,think,optionsFor(ply,{skill:20}));
      updateSurvival(raw.lines[0]);
      return {...raw,best:(survival?raw.lines[0]:varietyPick(raw.lines))?.pv[0] || raw.best};
    }
    return playingEngine.go(fen,1,settings.strength===100?2200:400+settings.strength*7,optionsFor(ply,{elo:eloFor(settings.strength)}));
  }).then(raw=>{
    if(!raw || stale())return;
    commitMove(rules.parseUciMove(fen,raw.best,settings.variant),ply,true);
    computer={phase:'idle',error:null};
    scheduleAnalysis();
  }).catch(error=>{if(ticket===computerTicket && id===gameId)computer={phase:'error',error:error.message};});
}
function commitMove(request,atPly=tailPly(),byEngine=false) {
  if(!Number.isInteger(atPly)||atPly<0||atPly>tailPly())throw Object.assign(new Error('Invalid history position.'),{code:'BAD_POSITION'});
  const base=fens[atPly],status=rules.status(fens,atPly);
  if(status.over)throw Object.assign(new Error('Game over.'),{code:'ILLEGAL_MOVE'});
  // Free play only locks Stockfish's side on the live position while it is playing; history and a paused engine are yours to move.
  const locked=settings.mode==='engine' || (atPly===tailPly() && !enginePaused);
  if(!byEngine && status.turn===computerColor() && locked)throw Object.assign(new Error('Wait for Stockfish.'),{code:'ILLEGAL_MOVE'});
  if(!byEngine)enginePaused=false;
  const applied=rules.apply(base,request,settings.variant);
  fens=fens.slice(0,atPly+1);moveLog=moveLog.slice(0,atPly);annotations=annotations.slice(0,atPly);evalHist=evalHist.slice(0,atPly+1);
  reviews=reviews.filter(index=>index<atPly);
  for(const key of cache.keys())if(key>atPly)cache.delete(key);
  moveLog.push({...applied.move,engine:byEngine});fens.push(applied.fen);revision++;
  const ply=atPly;
  if(isBook(ply))annotations[ply]={type:'book',label:'Book move',symbol:'B',explanation:`This follows ${openingName(ply+1)||'a recognised opening line'}. Both sides are still following established opening moves.`,depth:0,rule:'opening-book'};
  else queueReview(ply);
  if(rules.status(fens).over)requestReview();
  return applied;
}
function queueReview(ply) {
  annotations[ply]={type:'pending',label:'Reviewing move',symbol:'…',explanation:'Stockfish is checking this move against the best alternatives.'};
  if(!reviews.includes(ply))reviews.push(ply);
}
// Game review: grade every ungraded move and (in scheduleAnalysis) evaluate every position.
function requestReview() {
  reviewAll=true;
  moveLog.forEach((move,ply)=>{if(!annotations[ply] || annotations[ply].type==='unrated')queueReview(ply);});
}
// Walks every position at DEEP depth and re-grades each move as soon as both sides of it are deep. It re-reads the
// game each step, so moves played meanwhile are included and a changed position is searched again.
async function startDeepReview() {
  if(deep.active)return;
  const job=++deepJob, id=gameId, stale=()=>job!==deepJob || id!==gameId;
  deep={active:true,startedAt:Date.now()};
  try {
    for(let ply=0;ply<=tailPly();ply++) {
      if(stale())return;
      const fen=fens[ply], terminal=terminalReport(ply);
      if(terminal)evalHist[ply]=terminal.terminalCp;
      else if(!isDeep(cache.get(ply))) {
        const raw=await reviewEngine.exec(()=>reviewEngine.go(fen,3,DEEP.ms,optionsFor(ply,{depth:DEEP.depth})));
        if(stale())return;
        if(fens[ply]!==fen){ply--;continue;}
        const result={fen,ply,phase:'ready',depth:raw.depth,target:DEEP.depth,nps:raw.nps,lines:raw.lines.map((line,i)=>mkLine(line,i+1,fen)),threats:[],opening:openingName(ply),isTail:ply===tailPly()};
        cache.set(ply,result);
        if(result.lines[0])evalHist[ply]=result.lines[0].whiteCp;
      }
      const move=ply-1, post=terminal||cache.get(ply);
      if(move>=0 && annotations[move]?.type!=='book' && isDeep(cache.get(move)) && post)await reviewMove(move,cache.get(move),post);
    }
  } catch(error){if(error?.code!==SEARCH_CANCELLED)console.error('[deep review]',error.message);}
  finally {if(job===deepJob)deep={active:false,startedAt:0};}
}
function stopDeepReview(){deepJob++;reviewEngine.interrupt();deep={active:false,startedAt:0};}
function resetGame(next) {
  // Bump before stop, in one synchronous turn (the invariant note at the governor); the gameId change below guards results.
  stopComputer();analysisTicket++;engine.interrupt();stopDeepReview();
  analysisTabs.clear();
  settings=next;if(settings.variant==='chess960' && settings.seed===null)settings.seed=randomInt(960);
  gameId=randomUUID();revision++;fens=[rules.startFen(settings.variant,settings.seed)];moveLog=[];annotations=[];evalHist=[];reviews=[];reviewAll=false;enginePaused=false;survival=false;cache=new Map();
  // A new game can change what the chosen engine is capable of (variant, mode, strength): retireAll re-aims
  // every process per pickEngines and schedules the fresh analysis itself.
  retireAll();
}
// Push the governor's budgets into all engines. stopNow cuts a running analysis search (its caller has
// already bumped the ticket in this same turn); a live game reply or a 20 s deep search is never cut — those pick
// up the new Threads/Hash at their next go via the engine's pre-search flush. Coach engines retune too: they are
// never cut (their 300 ms asks finish inside any mode switch) but adopt the new budgets at their next go.
function retuneEngines(stopAnalysisNow=false) {
  const {budgets,hashBudgets}=governor;
  engine.retune({threads:budgets.analysis,hash:hashBudgets.analysis,priority:PRIORITY.below_normal,stopNow:stopAnalysisNow});
  playingEngine.retune({threads:budgets.playing,hash:hashBudgets.playing,priority:PRIORITY.below_normal});
  reviewEngine.retune({threads:budgets.deep,hash:hashBudgets.deep,priority:PRIORITY[governor.deepPriority]});
  for(const coach of coachEngines)coach.retune({threads:budgets.analysis,hash:64,priority:PRIORITY.below_normal});
}
// Switch binaries: bump both tickets and stop the deep review BEFORE retiring, so the exit-time waiter rejections
// ('Stockfish stopped.') hit stale guards and set no error phase; then rebuild both searches on the new engine.
// Re-aim all three processes after the engine choice or the game shape changed: each process gets the engine
// its capabilities allow (pickEngines), so a gap never silently degrades grading, threats or play strength.
// Retiring even an unchanged engine costs one cold respawn (~200 ms) but clears its tables between games.
function retireAll() {
  analysisTicket++;computerTicket++;stopDeepReview();
  // The coach pool spans the whole registry (not settings.engineId), so it is never re-aimed — only invalidated:
  // a changed game means fresh positions, and ucinewgame clears each engine's tables without a ~200 ms respawn.
  sweepTicket++;for(const coach of coachEngines){coach.interrupt();coach.newGame();}
  sweep={phase:'idle',results:[]};sweepCache=new Map();
  engine.retire();playingEngine.retire();reviewEngine.retire();
  const picks=pickEngines(currentEngine(),settings);
  engine.setExe(picks.analysis.path);reviewEngine.setExe(picks.analysis.path);playingEngine.setExe(picks.playing.path);
  engineNotices=picks.notices;
  scheduleAnalysis(tailPly());scheduleComputer();
}

const app=express();app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
app.use((req,res,next)=>{
  const hostname=(req.headers.host||'').split(':')[0].toLowerCase();
  if(!['localhost','127.0.0.1'].includes(hostname))return res.status(403).json({error:'Use the local CHESS address.'});
  if(req.method==='POST' && req.headers.origin && req.headers.origin!==`http://${req.headers.host}`)return res.status(403).json({error:'Cross-origin changes are not allowed.'});
  if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');next();
});
app.use(express.static(path.join(__dirname,'public')));
const route=(handler)=>(req,res,next)=>Promise.resolve().then(()=>handler(req,res)).catch(next);
function expectRevision(value){if(value!==undefined && value!==revision)throw Object.assign(new Error('The board changed. Try again from the refreshed position.'),{status:409});}
app.get('/api/state',(req,res)=>res.json(gameInfo()));
app.get('/api/analysis',(req,res)=>{
  prunePausedTabs();
  const {tab,visible}=req.query;
  if(typeof tab==='string' && tab && tab.length<=128){
    if(visible==='true')analysisTabs.set(tab,{hidden:false,seen:Date.now()});
    else if(analysisTabs.has(tab))analysisTabs.get(tab).seen=Date.now();
  }
  if(analysis.phase==='paused'&&!analysisPaused())scheduleAnalysis(tailPly());
  res.json({...analysis,sweep:{...sweep},game:gameInfo()});
});
app.get('/api/engines',(req,res)=>res.json({engines:ENGINES.map(({id,name,chess960,elo,multipv})=>({id,name,chess960,elo,multipv})),defaultId:ENGINES[0].id}));
app.get('/api/pgn',(req,res)=>res.type('application/x-chess-pgn').attachment('chess-game.pgn').send(rules.pgn(fens[0],moveLog,settings.variant)));
app.post('/api/new',route((req,res)=>{
  // powerMode/engineId/onlineFeatures are session-level: a client echoing them into a new game must not desync
  // the engines from the governor (validateSettings' key copy would otherwise assign them with no governor wiring
  // in resetGame) or silently flip the online opt-in, so the live values always win.
  resetGame(validateSettings({...req.body,powerMode:settings.powerMode,engineId:settings.engineId,onlineFeatures:settings.onlineFeatures}));
  res.json(gameInfo());
}));
app.post('/api/settings',route((req,res)=>{
  const next=validateSettings(req.body||{});
  for(const key of ['mode','variant','humanColor','engineSide','seed'])if(next[key]!==settings[key])throw new Error('Start a new game to change mode, variant or side.');
  const powerChanged=next.powerMode!==settings.powerMode, engineChanged=next.engineId!==settings.engineId;
  const refresh=next.analysisMs!==settings.analysisMs;
  // Apply first so retireAll/pickEngines read the new game shape, not the old one.
  settings=next;
  if(powerChanged){
    governor.setMode(next.powerMode);
    // One synchronous handler, bump-before-stop: scheduleAnalysis bumps the ticket and interrupts the analysis
    // search, then the retunes re-aim every engine under the new budgets with no event-loop turn in between.
    scheduleAnalysis(tailPly());
    retuneEngines(true);
  }
  if(engineChanged){cache.clear();evalHist=[];retireAll();}
  if(refresh)scheduleAnalysis(analysis.ply??tailPly(),{fresh:true});res.json({ok:true,settings,analysisMs:settings.analysisMs});
}));
// Closing a tab removes only its lease. A visible tab keeps the shared analysis alive.
app.post('/api/pause',route((req,res)=>{
  const {hidden,tab='(untabbed)',hello,bye}=req.body||{};
  if(typeof hidden!=='boolean'||typeof tab!=='string'||!tab||tab.length>128||(hello!==undefined&&typeof hello!=='boolean')||(bye!==undefined&&typeof bye!=='boolean'))throw new Error('Invalid pause request.');
  prunePausedTabs();
  if(bye)analysisTabs.delete(tab);
  else analysisTabs.set(tab,{hidden,seen:Date.now()});
  if(analysisPaused()){
    // Bump before stop, same synchronous turn (the unifying invariant): the cut-short search can never write the cache.
    analysisTicket++;engine.interrupt();
    pauseSweep(); // an interrupted sweep parks as 'paused' (its partial results stay on screen); it is never left 'running'
    analysis={...analysis,phase:'paused'};
  }else if(analysis.phase==='paused')scheduleAnalysis(tailPly());
  res.json({ok:true,paused:analysisPaused()});
}));
app.post('/api/move',route((req,res)=>{
  analysisTabs.clear(); // any user action resumes a paused board
  const body=req.body||{};expectRevision(body.revision);
  const ply=body.atPly===undefined?tailPly():body.atPly;
  if(body.baseFen!==undefined && body.baseFen!==fens[ply])throw Object.assign(new Error('The source position changed.'),{status:409});
  commitMove(body,ply);scheduleAnalysis();scheduleComputer();res.json(gameInfo());
}));
app.post('/api/analyze',route((req,res)=>{
  analysisTabs.clear();
  const {fen,atPly,revision:version}=req.body||{};expectRevision(version);
  const ply=atPly===undefined?fens.lastIndexOf(fen):atPly;
  if(!Number.isInteger(ply)||ply<0||ply>tailPly()||fens[ply]!==fen)throw new Error('Choose a position in this game.');
  scheduleAnalysis(ply);res.json({ok:true,fen,ply,legalMoves:rules.legalMoves(fen,settings.variant),...rules.status(fens,ply)});
}));
// Online lookups are opt-in and answer ONLY for positions of the current game — the same membership rule
// /api/analyze applies — so even an opted-in user cannot turn this server into an open proxy for arbitrary
// FENs. The off-refusal is a 409 conflict: the request itself is fine, the feature is deliberately off.
function requireOnlineGameFen(body) {
  if(!settings.onlineFeatures)throw Object.assign(new Error('Online features are off. Turn them on in Settings first.'),{status:409,code:'ONLINE_DISABLED'});
  const fen=body?.fen;
  if(typeof fen!=='string' || !fens.includes(fen))throw Object.assign(new Error('Choose a position in this game.'),{status:400,code:'BAD_POSITION'});
  return fen;
}
app.post('/api/online/tablebase',route(async(req,res)=>{
  const fen=requireOnlineGameFen(req.body);
  // The tablebase covers at most 7 pieces; count the piece letters of the board field locally so oversized
  // positions are rejected without any network call.
  const pieces=fen.split(' ')[0].replace(/[^KQRBNPkqrbnp]/g,'').length;
  if(pieces>7)throw Object.assign(new Error(`Tablebase lookups need 7 pieces or fewer; this position has ${pieces}.`),{status:400,code:'TOO_MANY_PIECES'});
  res.json(await online.tablebase(fen));
}));
app.post('/api/online/cloud-eval',route(async(req,res)=>{
  res.json(await online.cloudEval(requireOnlineGameFen(req.body)));
}));
app.get('/api/puzzles',route((req,res)=>res.json(puzzles.starter(req.query.index === undefined ? 0 : Number(req.query.index)))));
app.post('/api/puzzles/daily',route(async(req,res)=>{
  if(!settings.onlineFeatures)throw Object.assign(new Error('Enable Lichess lookups in Analysis, then return to Puzzles to load the daily puzzle.'),{status:409,code:'ONLINE_DISABLED'});
  res.json(await puzzles.daily());
}));
app.post('/api/puzzles/move',route((req,res)=>res.json(puzzles.move(req.body?.id,req.body?.moves))));
app.post('/api/puzzles/hint',route((req,res)=>res.json(puzzles.hint(req.body?.id,req.body?.moves))));
app.post('/api/puzzles/reveal',route((req,res)=>res.json({solution:puzzles.reveal(req.body?.id,req.body?.moves)})));
// Engine comparison: one first-choice ask per registry engine for a position of this game (the same
// membership rule as /api/analyze), run strictly sequentially through the interactive slot. {stop:true} cancels.
app.post('/api/sweep',route((req,res)=>{
  const body=req.body||{};
  if(body.stop){stopSweep();return res.json({ok:true});}
  analysisTabs.clear(); // asking for a sweep resumes the board
  expectRevision(body.revision);
  const {fen,atPly}=body;
  const ply=atPly===undefined?fens.lastIndexOf(fen):atPly;
  if(typeof fen!=='string'||!Number.isInteger(ply)||ply<0||ply>tailPly()||fens[ply]!==fen)throw Object.assign(new Error('Choose a position in this game.'),{status:400,code:'BAD_POSITION'});
  runSweep(ply);res.json({ok:true,fen,ply});
}));
app.post('/api/undo',route((req,res)=>{
  analysisTabs.clear();
  expectRevision(req.body?.revision);
  const requested=req.body?.atPly;
  if(requested!==undefined && (!Number.isInteger(requested)||requested<0||requested>tailPly()))throw new Error('Invalid history position.');
  let target=requested===undefined?tailPly()-1:requested;
  target=Math.max(0,target);
  // Against Stockfish a takeback returns to your turn; free play takes back exactly one move and pauses Stockfish.
  if(settings.mode==='engine')while(target>0 && rules.status(fens,target).turn===computerColor())target--;
  else enginePaused=Boolean(settings.engineSide);
  stopComputer();stopSweep();fens=fens.slice(0,target+1);moveLog=moveLog.slice(0,target);annotations=annotations.slice(0,target);evalHist=evalHist.slice(0,target+1);reviews=reviews.filter(index=>index<target);
  for(const key of cache.keys())if(key>target)cache.delete(key);
  for(const key of sweepCache.keys())if(key>target)sweepCache.delete(key);
  revision++;scheduleAnalysis();scheduleComputer();res.json(gameInfo());
}));
app.post('/api/engine-move',route((req,res)=>{analysisTabs.clear();expectRevision(req.body?.revision);enginePaused=false;scheduleComputer();res.json(gameInfo());}));
app.post('/api/retry',route((req,res)=>{analysisTabs.clear();scheduleAnalysis(analysis.ply??tailPly(),{fresh:true});scheduleComputer();res.json({ok:true});}));
app.post('/api/review',route((req,res)=>{analysisTabs.clear();requestReview();if(req.body?.deep)startDeepReview();scheduleAnalysis(analysis.ply??tailPly());res.json(gameInfo());}));
// Review "Retry": judge an alternative move without touching the game. It runs on the playing engine so it never waits behind analysis.
app.post('/api/try',route(async(req,res)=>{
  const {ply,from,to,promotion}=req.body||{};
  if(!Number.isInteger(ply)||ply<0||ply>=tailPly())throw new Error('Choose a move from this game.');
  const best=cache.get(ply)?.lines[0];
  if(!best)throw Object.assign(new Error('Wait for the review to finish.'),{status:409});
  const id=gameId,version=revision,applied=rules.apply(fens[ply],{from,to,...(promotion?{promotion}:{})},settings.variant);
  const info=rules.status([...fens.slice(0,ply+1),applied.fen]),mover=applied.move.color;
  let whiteCp;
  if(info.over)whiteCp=/Checkmate/.test(info.result)?(mover==='w'?100000:-100000):0;
  else {
    const raw=await playingEngine.exec(()=>playingEngine.go(applied.fen,1,Math.max(1200,settings.analysisMs),{chess960:is960(),startFen:fens[0],moves:[...moveLog.slice(0,ply).map(move=>move.uci),applied.move.uci]}));
    if(!raw.lines[0])throw new Error('Stockfish could not judge that move. Try again.');
    whiteCp=mkLine(raw.lines[0],1,applied.fen).whiteCp;
  }
  if(id!==gameId||version!==revision)throw Object.assign(new Error('The game changed.'),{status:409});
  const lossPoints=Math.max(0,expectedPoints(best.whiteCp,mover)-expectedPoints(whiteCp,mover));
  // Success matches the "Good" band: the best move, a mate, or within 0.05 expected points of the best.
  const success=applied.move.uci===best.uci || /#$/.test(applied.move.san) || lossPoints<=0.05;
  res.json({san:applied.move.san,uci:applied.move.uci,fen:applied.fen,whiteCp,lossPoints,success,bestSan:best.san,bestUci:best.uci});
}));
app.get('/api/brilliants',route(async(req,res)=>res.json({entries:await archive.list(),folder:archive.rootDir})));
app.get('/api/brilliants/:id',route(async(req,res)=>{const entry=await archive.get(req.params.id);if(!entry)return res.status(404).json({error:'Saved move not found.'});res.json(entry);}));
app.get('/api/brilliants/:id/image.png',route(async(req,res)=>{if(!await archive.get(req.params.id))return res.sendStatus(404);res.sendFile(archive.imagePath(req.params.id));}));
app.get('/api/brilliants/:id/game.pgn',route(async(req,res)=>{if(!await archive.get(req.params.id))return res.sendStatus(404);res.download(archive.pgnPath(req.params.id),'brilliant-move.pgn');}));
app.post('/api/brilliants/retry',route(async(req,res)=>{
  const ply=req.body?.ply;
  if(!Number.isInteger(ply)||annotations[ply]?.type!=='brilliant')throw new Error('Choose a verified brilliant move.');
  res.json(await saveBrilliant(ply,annotations[ply]));
}));
app.post('/api/brilliants/open-folder',route(async(req,res)=>{
  await fs.promises.mkdir(archive.rootDir,{recursive:true});
  if(process.platform==='win32'){const child=spawn('explorer.exe',[archive.rootDir],{detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref();}
  res.json({folder:archive.rootDir});
}));
app.post('/api/restore',route(async(req,res)=>{
  expectRevision(req.body?.revision);
  const version=revision;
  const entry=await archive.get(req.body?.id);if(!entry)throw new Error('Saved game not found.');
  expectRevision(version);
  const nextFens=[entry.startFen],nextMoves=[];
  for(const record of entry.moves){const applied=rules.apply(nextFens.at(-1),rules.parseUciMove(nextFens.at(-1),record.uci,entry.variant),entry.variant);nextFens.push(applied.fen);nextMoves.push(applied.move);}
  analysisTabs.clear();settings={...settings,mode:'free',engineSide:null,variant:entry.variant,seed:entry.seed??518};gameId=randomUUID();revision++;fens=nextFens;moveLog=nextMoves;annotations=nextMoves.map(()=>null);annotations[entry.ply-1]={...entry.annotation,symbol:'!!',archiveId:entry.id};evalHist=[];reviews=[];reviewAll=false;enginePaused=false;survival=false;cache=new Map();
  // A restored game can change the variant (and with it what the chosen engine is capable of): retireAll re-aims
  // every process per pickEngines — exactly what resetGame does — instead of leaving engines aimed at the old
  // game's shape. It also invalidates any sweep and its cache for the replaced game.
  retireAll();res.json(gameInfo());
}));
app.get('/api/hint',(req,res)=>{
  const ply=Number(req.query.ply),report=cache.get(ply);
  if(!report?.lines[0])return res.status(409).json({error:'Wait for this position to finish analysing.'});
  res.json(hint({fen:fens[ply],line:report.lines[0],variant:settings.variant}));
});
app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error);
  const status=error.status || (error.code==='ILLEGAL_MOVE'?400:400);
  res.status(status).json({error:error.message||'The request could not be completed.',code:error.code||'REQUEST_FAILED'});
});
if(require.main===module) {
  const server=app.listen(PORT,'127.0.0.1',()=>{
    console.log(`CHESS running at http://localhost:${PORT}`);scheduleAnalysis();
    if(process.platform==='win32' && process.env.CHESS_OPEN_BROWSER!=='0')exec(`start "" "http://localhost:${PORT}"`);
  });
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`CHESS is already running at http://localhost:${PORT}`:error.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{engine.quit();playingEngine.quit();reviewEngine.quit();for(const coach of coachEngines)coach.quit();server.close();process.exit(0);});
}
module.exports={app,engine,playingEngine,reviewEngine,governor,coachEngines,archive,online,timing,scoreText,prettyLine,mkLine,gameInfo,pickEngines,sweepPlan,prunePausedTabs,PAUSE_TTL};
