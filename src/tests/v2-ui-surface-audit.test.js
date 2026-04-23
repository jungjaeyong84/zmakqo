const assert = require('assert');
const fs = require('fs');
const path = require('path');

const createSystemRoutes = require('../routes/system.routes');
const createPipelineRoutes = require('../routes/pipeline.routes');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const routeFiles = [
  'src/routes/dashboard.settings.routes.js',
  'src/routes/dashboard.cashflow.routes.js',
  'src/routes/dashboard.profit.routes.js',
  'src/routes/dashboard.home.routes.js',
  'src/routes/state.routes.js',
  'src/routes/dashboard.control.routes.js',
];

for (const rel of routeFiles) {
  const src = read(rel);
  assert.ok(!src.includes('req.query.legacy'), `${rel} must not allow ?legacy=1 template switching`);
  assert.ok(!src.includes('.legacy.ejs'), `${rel} must not render legacy templates from active routes`);
}

const activeUiFiles = [
  'public/dashboard.html',
  'src/views/home.ejs',
  'src/views/settings.ejs',
  'src/views/control-plane.ejs',
  'src/views/partials/app_start.ejs',
  'src/views/partials/app_start_trader.ejs',
  'src/views/partials/app_start_unified.ejs',
  'src/views/partials/topnav5.ejs',
  'src/views/partials/topnav_trader.ejs',
  'src/views/partials/control_surface_nav.ejs',
];

for (const rel of activeUiFiles) {
  const src = read(rel);
  for (const forbidden of [
    '/dashboard/home?legacy=1',
    '/system/run',
    '/system/halt',
    '/scheduler/start',
    '/scheduler/stop',
    '/pipeline/run',
    '전략상태',
    '서버 정본',
    'Pine 비교',
  ]) {
    assert.ok(!src.includes(forbidden), `${rel} must not expose V1 UI surface token: ${forbidden}`);
  }
}

const systemRoutes = read('src/routes/system.routes.js');
assert.ok(systemRoutes.includes('V2_LEGACY_SYSTEM_RUN_DISABLED'), 'system run must fail closed in V2 mode');
assert.ok(systemRoutes.includes('V2_LEGACY_SYSTEM_HALT_DISABLED'), 'system halt must fail closed in V2 mode');

const pipelineRoutes = read('src/routes/pipeline.routes.js');
assert.ok(pipelineRoutes.includes('V2_LEGACY_PIPELINE_RUN_DISABLED'), 'pipeline run must fail closed in V2 mode');

const tradingActions = read('src/routes/trading.actions.routes.js');
assert.ok(!tradingActions.includes('tp0_order_id:'), 'native protection repair API must not expose TP0 order surface');

const settingsRoutes = read('src/routes/settings.routes.js');
for (const forbidden of [
  'tp1_ladder_stage1_tp0_hit_rate_min',
  'tp1_ladder_stage1_tp0_to_tp1_conversion_min',
  'tp1_ladder_stage2_tp0_hit_rate_min',
  'tp1_ladder_stage2_tp0_to_tp1_conversion_min',
]) {
  assert.ok(!settingsRoutes.includes(forbidden), `settings route must not accept retired TP0 ladder field: ${forbidden}`);
}

function findRoute(router, routePath) {
  return router.stack.find((entry) => entry.route && entry.route.path === routePath);
}

function invokeRoute(route, req = {}) {
  let statusCode = 200;
  let payload = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return value;
    },
  };
  const out = route.route.stack[0].handle(req, res);
  return Promise.resolve(out).then(() => ({ statusCode, payload }));
}

(async () => {
  const envBackup = { ...process.env };
  process.env.DONBEOLJA_V2_ENABLED = '1';
  process.env.ENABLE_PIPELINE_RUN = '1';
  try {
    const stateMachine = {
      STATES: { RUNNING: 'RUNNING', HALTED: 'HALTED' },
      getState() { return { state: 'RUNNING' }; },
      setState(state) { return { ok: true, state }; },
    };
    const scheduler = {
      start() { return { ok: true }; },
      stop() { return { ok: true }; },
    };
    const systemRouter = createSystemRoutes(stateMachine, scheduler);
    const runResult = await invokeRoute(findRoute(systemRouter, '/system/run'), { body: {}, query: {} });
    assert.strictEqual(runResult.statusCode, 410);
    assert.strictEqual(runResult.payload.reason, 'V2_LEGACY_SYSTEM_RUN_DISABLED');

    const haltResult = await invokeRoute(findRoute(systemRouter, '/system/halt'), { body: { confirm: true }, query: {} });
    assert.strictEqual(haltResult.statusCode, 410);
    assert.strictEqual(haltResult.payload.reason, 'V2_LEGACY_SYSTEM_HALT_DISABLED');

    const pipelineRouter = createPipelineRoutes(stateMachine);
    const pipelineResult = await invokeRoute(findRoute(pipelineRouter, '/pipeline/run'), { query: {} });
    assert.strictEqual(pipelineResult.statusCode, 410);
    assert.strictEqual(pipelineResult.payload.reason, 'V2_LEGACY_PIPELINE_RUN_DISABLED');
  } finally {
    process.env = envBackup;
  }

  console.log('V2_UI_SURFACE_AUDIT_TEST_OK');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
