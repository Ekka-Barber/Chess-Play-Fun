const { spawn } = require('node:child_process');
const { availableParallelism, setPriority, constants } = require('node:os');
const path = require('node:path');
// Unifying invariant (mirrored in server.js): any path that cuts a search short must invalidate it in the SAME
// synchronous turn — here via the epoch below, in the server via the ticket — so a parked or cut-short go can never
// write a stale result. SEARCH_CANCELLED is that normal control-flow signal, not an engine failure.
const SEARCH_CANCELLED='SEARCH_CANCELLED';
const cancelled=()=>Object.assign(new Error('Search cancelled.'),{code:SEARCH_CANCELLED});
// Interactive engines run below normal so a search never steals the UI's cores; the deep review drops to idle
// (PRIORITY_IDLE, with PRIORITY_LOW as the floor for builds lacking it) except in full mode.
const PRIORITY={below_normal:constants.priority.PRIORITY_BELOW_NORMAL,idle:constants.priority.PRIORITY_IDLE ?? constants.priority.PRIORITY_LOW};

class Engine {
  constructor({threads=Math.max(1,Math.min(4,availableParallelism()-1)),hash=128,exe=null,gate=null,idleMs=300000,priority=PRIORITY.below_normal}={}) {
    this.threads=threads; this.hash=hash; this.exe=exe; this.gate=gate; this.idleMs=idleMs; this.priority=priority;
    this.proc=null; this.starting=null;
    this.buffer=''; this.waiters=[]; this.onInfo=null; this.chain=Promise.resolve();
    this.epoch=0; this.active=0; this.idleTimer=null; this._retuneDirty=false;
  }
  exec(fn) {
    this.clearIdle(); // a queued step is starting: any pending idle-quit must not fire mid-step
    const result=this.chain.then(fn);
    // The idle-quit check rides at the tail of the chain and arms only if it is still the latest tail: a step
    // queued in the same microtask cascade must not leave a stale timer armed beside it.
    const tail=result.catch(()=>{}).then(()=>{if(this.chain===tail)this.maybeIdle();});
    this.chain=tail;
    return result; }
  maybeIdle() {
    if(this.idleTimer || this.active || !this.proc)return;
    // Idle-quit: after idleMs with no searches the process goes away and the next go respawns it. Always unref()d —
    // a pending quit must never keep node (or `node --test`) alive.
    this.idleTimer=setTimeout(()=>{
      this.idleTimer=null;
      const proc=this.proc;
      if(!proc)return;
      this.proc=null;this.onInfo=null;
      // The exit handler's this.proc!==proc guard makes its later cleanup a no-op, and position is sent per go, so
      // a respawn loses nothing while the human is thinking.
      try{proc.stdin.write('quit\n');}catch(_) {}
    },this.idleMs);
    this.idleTimer.unref();
  }
  clearIdle(){if(this.idleTimer){clearTimeout(this.idleTimer);this.idleTimer=null;}}
  async start() {
    if(this.starting) return this.starting;
    if(this.proc) return;
    this.clearIdle();
    this.starting=(async()=>{
      // Spawn precedence is unchanged and env-first: STOCKFISH_EXE overrides everything (the custom-build escape
      // hatch), then the engines.json choice passed as exe, then the built-in binary.
      const proc=spawn(process.env.STOCKFISH_EXE || this.exe || path.join(__dirname,'..','stockfish','stockfish-windows-x86-64-universal.exe'),[],{windowsHide:true});
      this.proc=proc;this.buffer='';
      const fail=(error)=>{
        if(this.proc!==proc)return;
        this.proc=null;this.onInfo=null;
        for(const waiter of this.waiters.splice(0))waiter.reject(error);
      };
      proc.on('error',fail);proc.on('exit',()=>fail(new Error('Stockfish stopped. Use Retry engine to reconnect.')));
      proc.stdin.on('error',fail);proc.stdout.on('data',(data)=>{if(this.proc===proc)this.feed(data.toString());});
      try{setPriority(proc.pid,this.priority);}catch(_) {}
      await this.command('uci',line=>line==='uciok',20000);
      this.send(`setoption name Threads value ${this.threads}`);
      this.send(`setoption name Hash value ${this.hash}`);
      this.send('setoption name UCI_ShowWDL value true');
      await this.command('isready',line=>line==='readyok');
    })().finally(()=>{this.starting=null;});
    return this.starting;
  }
  send(line) {
    if(!this.proc || this.proc.stdin.destroyed)throw new Error('Stockfish is unavailable. Use Retry engine.');
    this.proc.stdin.write(line+'\n');
  }
  feed(chunk) {
    this.buffer+=chunk;
    let end;
    while((end=this.buffer.indexOf('\n'))>=0) {
      const line=this.buffer.slice(0,end).trim();this.buffer=this.buffer.slice(end+1);
      if(line.startsWith('info ') && this.onInfo)this.onInfo(line);
      const index=this.waiters.findIndex(waiter=>waiter.test(line));
      if(index>=0)this.waiters.splice(index,1)[0].resolve(line);
    }
  }
  command(line,test,timeout=10000) {
    return new Promise((resolve,reject)=>{
      const waiter={test,resolve:(value)=>{clearTimeout(timer);resolve(value);},reject:(error)=>{clearTimeout(timer);reject(error);}};
      const timer=setTimeout(()=>{
        this.waiters=this.waiters.filter(item=>item!==waiter);
        reject(new Error('Stockfish timed out. Use Retry engine.'));
        this.proc?.kill();
      },timeout);
      this.waiters.push(waiter);
      try{this.send(line);}catch(error){this.waiters=this.waiters.filter(item=>item!==waiter);waiter.reject(error);}
    });
  }
  async go(fen,multipv,movetime,options={}) {
    const epoch=this.epoch;
    this.clearIdle();this.active++;
    let release=null;
    try {
      if(this.gate)release=await this.gate();
      if(epoch!==this.epoch)throw cancelled(); // a go parked on the interactive slot was cut short
      await this.start();
      if(epoch!==this.epoch)throw cancelled(); // killed during the uci handshake (cold start or post-idle-quit respawn)
      // From here through sending 'go' is one synchronous block, so no interrupt can slip between the check and the send.
      if(this._retuneDirty){this._retuneDirty=false;this.send(`setoption name Threads value ${this.threads}`);this.send(`setoption name Hash value ${this.hash}`);}
      this.send(`setoption name UCI_Chess960 value ${Boolean(options.chess960)}`);
      // UCI_Elo (1320–3190) is Stockfish's calibrated strength limit; without it the engine plays at full strength.
      this.send(`setoption name UCI_LimitStrength value ${Boolean(options.elo)}`);
      if(options.elo)this.send(`setoption name UCI_Elo value ${options.elo}`);
      this.send(`setoption name Skill Level value ${options.skill ?? 20}`);
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${options.startFen || fen}${options.moves?.length ? ` moves ${options.moves.join(' ')}` : ''}`);
      const lines=new Map();let depth=0,nps=0,lastUpdate=0;
      const snapshot=()=>({lines:[...lines.entries()].sort((a,b)=>a[0]-b[0]).map(([,value])=>value),depth,nps});
      this.onInfo=(line)=>{
        if(line.startsWith('info string '))return;
        const d=line.match(/\bdepth (\d+)/),n=line.match(/\bnps (\d+)/),rank=line.match(/\bmultipv (\d+)/);
        if(d)depth=Math.max(depth,+d[1]);if(n)nps=+n[1];
        const cp=line.match(/\bscore cp (-?\d+)/),mate=line.match(/\bscore mate (-?\d+)/),pv=line.match(/\bpv (.+)$/),wdl=line.match(/\bwdl (\d+) (\d+) (\d+)/);
        if((cp||mate)&&pv)lines.set(rank?+rank[1]:1,{score:cp?{type:'cp',value:+cp[1]}:{type:'mate',value:+mate[1]},pv:pv[1].trim().split(/\s+/),depth:d?+d[1]:depth,wdl:wdl?wdl.slice(1).map(Number):null});
        if(options.onUpdate && lines.size && Date.now()-lastUpdate>=100){lastUpdate=Date.now();options.onUpdate(snapshot());}
      };
      // With options.depth Stockfish stops at that depth or at movetime, whichever comes first.
      const best=await this.command(`go ${options.depth ? `depth ${options.depth} ` : ''}movetime ${movetime}${options.searchmoves?.length ? ` searchmoves ${options.searchmoves.join(' ')}` : ''}`,line=>line.startsWith('bestmove'),movetime+12000);
      return {...snapshot(),best:best.split(' ')[1]};
    } finally {
      this.onInfo=null;this.active--;
      if(release)release();
    }
  }
  // Invalidate every running, parked or mid-handshake go (the epoch) and stop a running search (the onInfo guard
  // keeps 'stop' quiet when nothing is searching). Callers must bump their ticket in the SAME synchronous turn —
  // that pairing is the app-wide stale-result invariant.
  interrupt(){this.epoch++;if(this.proc && this.onInfo)try{this.send('stop');}catch(_) {}}
  stop(){this.interrupt();}
  // Switch binaries: setExe remembers the choice, retire quits the current process now (in-flight waiters see the
  // familiar 'stopped' wording, which the server's stale guards swallow) and the next go respawns from the new exe.
  setExe(exe){this.exe=exe;}
  retire(){
    this.clearIdle();this.epoch++;
    const proc=this.proc;
    this.proc=null;this.onInfo=null;this.starting=null;this._retuneDirty=false;
    for(const waiter of this.waiters.splice(0))waiter.reject(new Error('Stockfish stopped. Use Retry engine to reconnect.'));
    if(proc)try{proc.stdin.write('quit\n');}catch(_) {}
  }
  // priority lands on a live pid immediately; Threads/Hash are stored for every spawn and applied live as setoptions
  // at the next go's pre-search flush. stopNow (analysis engine only) also cuts a running search — its caller bumps
  // the ticket and reschedules in the same turn.
  retune({threads,hash,priority,stopNow=false}={}){
    if(threads!==undefined)this.threads=threads;
    if(hash!==undefined)this.hash=hash;
    if(priority!==undefined){this.priority=priority;if(this.proc)try{setPriority(this.proc.pid,priority);}catch(_) {}}
    if(threads!==undefined||hash!==undefined)this._retuneDirty=true;
    if(stopNow)this.interrupt();
  }
  newGame(){if(this.proc)this.send('ucinewgame');}
  quit(){this.clearIdle();if(this.proc)try{this.send('quit');}catch(_) {}}
}
module.exports={Engine,SEARCH_CANCELLED,PRIORITY};
