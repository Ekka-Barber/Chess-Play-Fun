// Resource governor: ONE interactive slot shared by the two engines that answer a human in real time (live analysis
// and game replies), plus per-mode thread/hash budgets for all three engines. The deep review never takes the slot —
// its minutes-long searches must never block gameplay — it is only thread-capped and runs at a lower OS priority.
// Surface Pro 9 math (2 fast P-cores + 8 E-cores in a thermally bound tablet): balanced's peak is 2 interactive +
// 2 deep = 4 threads, the brief's P-core ceiling; full is the deliberate plugged-in ceiling at 3 + 3 = 6 with the
// deep review merely below-normal; laptop keeps the machine cool at 1 + 1. The table intentionally lowers today's
// parallelism-derived defaults (4/2/4 on 12 logical cores) — that reduction is the feature.
// Hash budgets mirror today's configured hashes in balanced (128/128/256) and scale with each mode's thread count.
const MODES={
  full:{budgets:{analysis:3,playing:2,deep:3},hashBudgets:{analysis:256,playing:256,deep:512},deepPriority:'below_normal'},
  balanced:{budgets:{analysis:2,playing:2,deep:2},hashBudgets:{analysis:128,playing:128,deep:256},deepPriority:'idle'},
  laptop:{budgets:{analysis:1,playing:1,deep:1},hashBudgets:{analysis:64,playing:64,deep:128},deepPriority:'idle'},
};

function createGovernor({mode='balanced',preempt=null}={}) {
  if(!Object.hasOwn(MODES,mode))throw new Error(`Unknown power mode: ${mode}.`);
  let current=mode;
  const slot={holder:null,queue:[]};
  function acquire(kind='analysis') {
    return new Promise((resolve)=>{
      const entry={kind,resolve};
      entry.release=()=>{
        if(slot.holder!==entry)return; // a double release must never hand the slot to two waiters
        const next=slot.queue.shift();
        slot.holder=next||null;
        if(next)next.resolve(next.release);
      };
      if(!slot.holder){slot.holder=entry;resolve(entry.release);return;}
      if(kind==='playing') {
        // A game reply jumps every queued analysis: /api/try and replies must never wait behind analysis. Preempt
        // asks the RUNNING analysis to stop exactly once (the server wires it as bump-ticket-then-stop in the same
        // turn). A running playing search is never preempted.
        slot.queue.unshift(entry);
        if(slot.holder.kind!=='playing' && preempt)preempt();
      } else slot.queue.push(entry); // queued analysis acquires are strict FIFO
    });
  }
  return {
    get mode(){return current;},
    setMode(next){if(!Object.hasOwn(MODES,next))throw new Error(`Unknown power mode: ${next}.`);current=next;},
    get budgets(){return {...MODES[current].budgets};},
    get hashBudgets(){return {...MODES[current].hashBudgets};},
    get deepPriority(){return MODES[current].deepPriority;},
    acquire,
    status(){return {mode:current,budgets:{...MODES[current].budgets},hashBudgets:{...MODES[current].hashBudgets},busy:Boolean(slot.holder),waiting:slot.queue.length};},
  };
}
module.exports={createGovernor,MODES};
