const assert = require('assert');
const app = require('../api/server');
const { fetchYahooClose } = app;
const axios = require('axios').default;

(async () => {
  const originalGet = axios.get;

  try {
    const attempts = [];
    axios.get = async (url) => {
      attempts.push(url);
      if (url.includes('XAUUSD=X')) {
        const err = new Error('not_found');
        err.response = { status: 404 };
        throw err;
      }
      if (url.includes('interval=1m')) {
        throw new Error('interval_fail');
      }
      return {
        data: {
          chart: {
            result: [
              {
                indicators: { quote: [{ close: [null, 1950.12] }] },
                timestamp: [1700000000, 1700000300]
              }
            ]
          }
        }
      };
    };

    const result = await fetchYahooClose('XAU/USD');
    assert.strictEqual(result.price, 1950.12);
    assert.strictEqual(result.timeUTC, new Date(1700000300 * 1000).toISOString().slice(11, 16));
    assert.strictEqual(result.note, 'latest CLOSED price');
    assert.ok(attempts.some((url) => url.includes('XAUUSD=X') && url.includes('interval=1m')));
    assert.ok(attempts.some((url) => url.includes('XAU=X') && url.includes('interval=5m')));

    axios.get = async () => {
      throw new Error('fail');
    };

    let threw = false;
    try {
      await fetchYahooClose('XAG/USD');
    } catch (e) {
      threw = true;
      assert.strictEqual(e.message, 'yahoo_unavailable');
    }
    assert.ok(threw, 'fetchYahooClose should throw when all fallbacks fail');
  } finally {
    axios.get = originalGet;
  }

  console.log('fetchYahooClose tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
