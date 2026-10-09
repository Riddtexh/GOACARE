'use strict';
// In-memory failure throttle: `max` failures per key within `windowMs`.
function createThrottle(max = 8, windowMs = 15 * 60 * 1000) {
  const attempts = new Map();
  return {
    blocked(key) {
      const a = attempts.get(key);
      if (!a) return false;
      if (Date.now() - a.first > windowMs) { attempts.delete(key); return false; }
      return a.count >= max;
    },
    fail(key) {
      const a = attempts.get(key);
      if (!a || Date.now() - a.first > windowMs) attempts.set(key, { count: 1, first: Date.now() });
      else a.count++;
    },
    clear(key) { attempts.delete(key); }
  };
}
module.exports = { createThrottle };
