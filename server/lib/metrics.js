'use strict';
// Rolling average of API response time (last 500 requests) for the impact numbers.
const samples = [];
module.exports = {
  record(ms) { samples.push(ms); if (samples.length > 500) samples.shift(); },
  avg() { return samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length * 10) / 10 : 0; },
  count() { return samples.length; }
};
