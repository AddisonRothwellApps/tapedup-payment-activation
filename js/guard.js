// Stops you leaving a screen with unsaved changes. A screen registers a
// check (true = there are unsaved changes) and what to do when someone tries
// to leave anyway (e.g. flash its Save bar). The router asks before changing
// screen, and the browser asks before closing or reloading the tab.
let check = null;
let onBlocked = null;

export const leaveGuard = {
  set(fn, blocked) { check = fn; onBlocked = blocked; },
  clear() { check = null; onBlocked = null; },
  blocked() { try { return !!(check && check()); } catch (err) { return false; } },
  notify() { if (onBlocked) onBlocked(); },
};
