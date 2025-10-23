const assert = require('assert');
const app = require('../api/server');
const { formatCompactPrice } = app;

assert.strictEqual(typeof formatCompactPrice, 'function', 'formatCompactPrice should be exported');

const cases = [
  { price: 1234.56789, expected: '1234.57' },
  { price: 12.345678, expected: '12.3457' },
  { price: 0.123456789, expected: '0.123457' }
];

for (const { price, expected } of cases) {
  const output = formatCompactPrice('10:00', 'XAU/USD', price, 'latest CLOSED price');
  const lines = output.split('\n');
  assert.strictEqual(lines.length, 4, 'Output must contain exactly 4 lines');
  assert.strictEqual(lines[0], 'Time (UTC): 10:00');
  assert.strictEqual(lines[1], 'Symbol: XAU/USD');
  assert.strictEqual(lines[2], `Price: ${expected}`);
  assert.strictEqual(lines[3], 'Note: latest CLOSED price');
}

console.log('formatCompactPrice tests passed');
