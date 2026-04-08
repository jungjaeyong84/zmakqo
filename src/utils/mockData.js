// src/utils/mockData.js
// Mock data for UI development without Firestore connection.
// Activate with env: MOCK_DATA=1

const MOCK_ENABLED = process.env.MOCK_DATA === '1';

const MOCK_HOME_PAYLOAD = {
  exchange: 'BINANCEFUT',
  budget_summary: { unit: 'USDT', total_max_krw: 12450.50, total_used_krw: 3200.00, total_used_pct: 0.257 },
  budget_perf: { unit: 'USDT', total_pnl_krw: 850.30, total_realized_krw: 620.10, total_unrealized_krw: 230.20 },
  home_profit_ranges: {
    today: { total: 45.20 },
    d7: { total: 320.50 },
    d30: { total: 850.30 },
    m6: { total: 2100.00 },
    total: { total: 3500.75 },
  },
  weekly_range_perf: {
    total_realized_krw: 320.50,
    trades_n: 18,
    top3: [
      { market: 'BTCUSDT', realized_krw: 180.20, share_pct: 0.562 },
      { market: 'ETHUSDT', realized_krw: 95.30, share_pct: 0.297 },
      { market: 'BNBUSDT', realized_krw: 45.00, share_pct: 0.140 },
    ],
  },
  signals12: [
    { symbol: 'BTCUSDT', event: 'LONG', entry_grade: 'CORE', source: 'SERVER', created_at: new Date().toISOString(), exec_plan: { status: 'FILLED' }, signal_id: 'MOCK_SIG_1' },
    { symbol: 'ETHUSDT', event: 'SHORT', entry_grade: 'EARLY', source: 'SERVER', created_at: new Date(Date.now() - 900000).toISOString(), exec_plan: { status: 'PENDING' }, signal_id: 'MOCK_SIG_2' },
    { symbol: 'BNBUSDT', event: 'LONG', entry_grade: 'CORE', source: 'PINE_SHADOW', created_at: new Date(Date.now() - 1800000).toISOString(), signal_source: 'DROP', signal_id: 'MOCK_SIG_3' },
    { symbol: 'SOLUSDT', event: 'SHORT', entry_grade: 'CORE', source: 'SERVER', created_at: new Date(Date.now() - 3600000).toISOString(), exec_plan: { status: 'FILLED' }, signal_id: 'MOCK_SIG_4' },
    { symbol: 'XRPUSDT', event: 'LONG', entry_grade: 'EARLY', source: 'SERVER', created_at: new Date(Date.now() - 5400000).toISOString(), exec_plan: { status: 'CANCELED' }, signal_id: 'MOCK_SIG_5' },
  ],
  fills12: [
    { symbol: 'BTCUSDT', event: 'LONG', exec_price: 67850.20, created_at: new Date().toISOString(), display_exec_ko: '매수 체결', fill_id: 'MOCK_FILL_1' },
    { symbol: 'SOLUSDT', event: 'SHORT', exec_price: 142.35, created_at: new Date(Date.now() - 3600000).toISOString(), display_exec_ko: '매도 체결', fill_id: 'MOCK_FILL_2' },
    { symbol: 'ETHUSDT', event: 'EXIT_TP_P1_1.65P', exec_price: 2055.80, created_at: new Date(Date.now() - 7200000).toISOString(), display_exec_ko: '목표가 청산', fill_id: 'MOCK_FILL_3' },
  ],
  intent_failures: { total: 2, by_status: { rejected_provider: 1, timeout_provider: 1 }, top: [{ reason: 'INSUFFICIENT_MARGIN', count: 1 }] },
  mission_control: {
    hero: { title: '자동매매 정상 운영 중', detail: '전략이 시장을 분석하고 자동으로 매매합니다.' },
    metrics: [
      { label: '활성 포지션', value: '3개', meta: 'BTC, ETH, SOL' },
      { label: '오늘 거래', value: '7건', meta: '매수 4건, 매도 3건' },
      { label: '승률 (30일)', value: '62.5%', meta: '20승 12패' },
      { label: '상태', value: '정상', meta: '모든 시스템 정상 운영' },
    ],
  },
  markets: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'AXSUSDT', 'DOGEUSDT'],
  markets_expected: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'AXSUSDT', 'DOGEUSDT'],
  active_positions: [
    { symbol: 'BTCUSDT', side: 'LONG', avg_price: 67850, size_pct: 1, entry_at: new Date(Date.now() - 3 * 3600000).toISOString(), pnl_pct: 0.008, pnl_value: 5.42, leverage: 2 },
    { symbol: 'BNBUSDT', side: 'SHORT', avg_price: 612.3, size_pct: 1, entry_at: new Date(Date.now() - 45 * 60000).toISOString(), pnl_pct: -0.002, pnl_value: -1.23, leverage: 2 },
  ],
};

function isMockEnabled() {
  return MOCK_ENABLED;
}

function getMockHomePayload() {
  return { ...MOCK_HOME_PAYLOAD };
}

module.exports = { isMockEnabled, getMockHomePayload };
