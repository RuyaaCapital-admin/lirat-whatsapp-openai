import assert from 'node:assert';
import { parseIntent } from '../src/tools/symbol';

theArText();

function theArText() {
  const signalIntent = parseIntent('صفقة عالفضة عل 5 دقايق');
  assert.strictEqual(signalIntent.symbol, 'XAGUSD', 'should recognise silver');
  assert.strictEqual(signalIntent.timeframe, '5min', 'should map 5 minute timeframe');
  assert.strictEqual(signalIntent.wantsSignal, true);
  assert.strictEqual(signalIntent.wantsPrice, false);
}

(function moreCases() {
  const priceIntent = parseIntent('سعر الذهب دقيقة');
  assert.strictEqual(priceIntent.symbol, 'XAUUSD');
  assert.strictEqual(priceIntent.wantsPrice, true);
  assert.strictEqual(priceIntent.timeframe, '1min');

  const cryptoIntent = parseIntent('Signal BTC 15m');
  assert.strictEqual(cryptoIntent.symbol, 'BTCUSDT');
  assert.strictEqual(cryptoIntent.timeframe, '15min');
  assert.strictEqual(cryptoIntent.route, 'crypto');
})();

console.log('parse-intent tests passed');
