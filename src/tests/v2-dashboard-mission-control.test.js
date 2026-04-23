const assert = require('assert');
const fs = require('fs');
const path = require('path');

const createDashboardRoutes = require('../routes/dashboard.routes');

const repoRoot = path.resolve(__dirname, '..', '..');
const dashboardHtml = fs.readFileSync(path.join(repoRoot, 'public', 'dashboard.html'), 'utf8');

for (const forbidden of [
  '/system/run',
  '/system/halt',
  '/scheduler/start',
  '/scheduler/stop',
  '/scheduler/tick?force=1',
  '/pipeline/run',
  'Scheduler START',
  'Scheduler STOP',
  'Tick (force)',
]) {
  assert.ok(!dashboardHtml.includes(forbidden), `V1 control must not appear in V2 dashboard: ${forbidden}`);
}

const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'server', 'app.js'), 'utf8');
assert.ok(appSource.includes('"/api/v2/mission-control"'), 'PUBLIC_UI_NO_AUTH must allow V2 mission-control API');

const envBackup = { ...process.env };
process.env.DONBEOLJA_V2_ENABLED = '1';
process.env.DONBEOLJA_V2_CANARY_ONLY = '1';
process.env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED = '0';
process.env.DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE = 'OPENCLAW_CRON';
process.env.DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL = '0';
process.env.OPENCLAW_AGENT_APPLY_ENABLED = '0';
process.env.OPENCLAW_CONDUCTOR_SHADOW_ONLY = '1';

try {
  const router = createDashboardRoutes(
    { getState() { return {}; } },
    { status() { return {}; } }
  );
  const layer = router.stack.find((entry) => entry.route && entry.route.path === '/api/v2/mission-control');
  assert.ok(layer, 'V2 mission-control API route must be registered');

  let payload = null;
  layer.route.stack[0].handle({}, { json(value) { payload = value; } });

  assert.ok(payload && payload.ok === true, 'V2 mission-control snapshot must be ok');
  assert.strictEqual(payload.mode, 'V2');
  assert.strictEqual(payload.scheduler_cutover, 'OPENCLAW_CRON');
  assert.strictEqual(payload.runtime_flags.v2_enabled, '1');
  assert.strictEqual(payload.runtime_flags.allow_legacy_webhook_signal, '0');
  assert.strictEqual(payload.entry_canary.coverage_target_minutes, 1440);
  assert.strictEqual(payload.exit_canary.coverage_target_minutes, 1440);
  assert.ok(Array.isArray(payload.blockers), 'Mission snapshot must expose blockers as an array');
} finally {
  process.env = envBackup;
}

console.log('V2_DASHBOARD_MISSION_CONTROL_TEST_OK');
