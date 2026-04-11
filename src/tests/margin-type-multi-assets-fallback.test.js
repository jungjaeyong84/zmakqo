const assert = require('assert');
const { __test } = require('../engine/paperBinanceRunner');

(() => {
  const fn = __test && __test.isBinanceMultiAssetsIsolatedMarginBlocked;
  assert.strictEqual(typeof fn, 'function', 'isBinanceMultiAssetsIsolatedMarginBlocked export missing');
  const openOrdersConflictFn = __test && __test.isBinanceMarginTypeOpenOrdersConflict;
  assert.strictEqual(typeof openOrdersConflictFn, 'function', 'isBinanceMarginTypeOpenOrdersConflict export missing');

  assert.strictEqual(
    fn({ code: -4168, message: 'BINANCEFUT_HTTP_400: {"code":-4168,"msg":"Unable to adjust to isolated-margin mode under the Multi-Assets mode."}' }, 'ISOLATED'),
    true
  );
  assert.strictEqual(
    fn({ message: 'BINANCEFUT_HTTP_400: {"code":-4168,"msg":"Unable to adjust to isolated-margin mode under the Multi-Assets mode."}' }, 'ISOLATED'),
    true
  );
  assert.strictEqual(
    fn({ code: -4168, message: 'same message' }, 'CROSSED'),
    false
  );
  assert.strictEqual(
    fn({ code: -4046, message: 'No need to change margin type.' }, 'ISOLATED'),
    false
  );
  assert.strictEqual(
    openOrdersConflictFn({ code: -4067, message: 'BINANCEFUT_HTTP_400: {"code":-4067,"msg":"Position side cannot be changed if there exists open orders."}' }),
    true
  );
  assert.strictEqual(
    openOrdersConflictFn({ message: 'Position side cannot be changed if there exists open orders.' }),
    true
  );
  assert.strictEqual(
    openOrdersConflictFn({ code: -4046, message: 'No need to change margin type.' }),
    false
  );

  console.log('MARGIN_TYPE_MULTI_ASSETS_FALLBACK_TEST_OK');
})();
