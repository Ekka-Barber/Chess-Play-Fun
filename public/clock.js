(function (root) {
  // Chess clock, client-side only. The server stays the rules authority and its API gains nothing:
  // this module computes time, app.js owns the rendering and the input lock, and nothing is ever
  // posted. Persisting a running clock across page reloads is out of scope — a reload drops it and
  // the next new game starts its clock fresh at full time. Elapsed time is measured against
  // performance.now() stamps, so a throttled interval in a hidden tab only coarsens the display;
  // the count itself stays exact.
  const LOW_MS = 20000;

  // snaps[i] is the remaining time after i completed plies, so a takeback can rewind to the exact
  // halves the position was played with. stamp:null marks a clock that has not started counting.
  const newClock = (minutes, incrementSeconds) => {
    const baseMs = minutes * 60000;
    return { minutes, incrementSeconds, baseMs, incMs: incrementSeconds * 1000, ms: { w: baseMs, b: baseMs }, snaps: [{ w: baseMs, b: baseMs }], ply: 0, running: null, flagged: null, stamp: null };
  };

  // Only the side to move pays. Returns the colour that just flagged, or null.
  function tickClock(state, now) {
    if (!state.running || state.flagged) return null;
    state.ms[state.running] = Math.max(0, state.ms[state.running] - (now - state.stamp));
    state.stamp = now;
    if (state.ms[state.running] > 0) return null;
    state.flagged = state.running;
    state.running = null;
    return state.flagged;
  }

  // Reconcile with an adopted server state: plies = moveLog.length, moves = game.moveLog (only the
  // entries at/after state.ply are read), turn = the side to move at that ply, over = game.over.
  function syncClock(state, plies, moves, turn, over, now) {
    if (plies < state.ply) {
      // A takeback rewinds to the snapshot kept for the resulting position and clears any flag —
      // taking back after running out of time is a fresh start from that ply, not a lost game.
      state.ply = plies;
      state.ms = { ...(state.snaps[plies] ?? { w: state.baseMs, b: state.baseMs }) };
      state.flagged = null;
      state.running = over ? null : turn;
      state.stamp = now;
    } else if (state.flagged) {
      // The flag already ended the game locally; a ply that lands after it (an engine reply that
      // was in flight) is banked as a frozen copy so a takeback can still rewind past it cleanly.
      while (state.ply < plies) { state.ply++; state.snaps[state.ply] = { ...state.ms }; }
    } else if (plies > state.ply) {
      // A completed move: the side that was counting pays the elapsed span (its own move lands with
      // the response, so this is tight; an engine reply arrives with the next poll and pays at most
      // one poll of extra thinking). Each completed mover then earns its Fischer increment. Plies
      // that batch together between two polls cannot be timed separately — that mover pays nothing
      // and still earns the increment, the honest limit of a clock that never leaves the client.
      if (state.running) tickClock(state, now);
      while (state.ply < plies) {
        const mover = moves[state.ply]?.color;
        if (mover) state.ms[mover] += state.incMs;
        state.ply++;
        state.snaps[state.ply] = { ...state.ms };
      }
      state.running = over ? null : turn; // the server ended it (checkmate, draw): freeze, no flag.
      state.stamp = now;
    } else if (over && state.running) {
      state.running = null; // server game end observed on the same ply: stop counting.
    }
    // A freshly armed game starts counting the side to move immediately (White from move one).
    if (state.stamp === null && !over) { state.running = turn; state.stamp = now; }
  }

  // Readouts count up to the last whole displayed unit (0:01 is honest until it is truly 0:00.0),
  // and under LOW_MS the tenths digit appears — a low-time cue that is not colour alone.
  function formatClock(ms) {
    if (ms <= 0) return '0:00.0';
    if (ms <= LOW_MS) { const tenths = Math.ceil(ms / 100); return `0:${String(Math.floor(tenths / 10)).padStart(2, '0')}.${tenths % 10}`; }
    const total = Math.ceil(ms / 1000);
    if (total < 3600) return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    return `${Math.floor(total / 3600)}:${String(Math.floor(total % 3600 / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  const isLow = (ms) => ms <= LOW_MS;

  const api = { LOW_MS, newClock, tickClock, syncClock, formatClock, isLow };
  if (typeof module !== 'undefined') module.exports = api;
  else root.CHESS_CLOCK = api;
})(typeof window === 'undefined' ? globalThis : window);
