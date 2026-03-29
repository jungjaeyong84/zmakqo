// src/config/frozen.js
// Phase0/12W: 고정 상수(멀티마켓/스키마/KPI 기준선)
// - 실험 기간 내 비교 가능성 확보를 위해 "기본값"을 코드에 고정
// - 환경변수로 임의 변경하는 패턴을 최소화

const SCHEMA_VERSION = 1;

// Timeframe 고정
const TF_60M = "60m";
const BAR_INTERVAL_MS_60M = 60 * 60 * 1000;
const TF_15M = "15m";
const BAR_INTERVAL_MS_15M = 15 * 60 * 1000;

// Signal 평가(승률/EV) 기준선 고정
const SIGNAL_EVAL_VERSION = "v1";
const SIGNAL_EVAL_HORIZON_BARS = 3;

// Signal KPI(주간 평가) 결정 임계값 고정
const SIGNAL_KPI_MIN_N = 20; // 평가 의사결정 최소 표본수
const SIGNAL_KPI_MIN_EVAL_N = 20; // 실제 평가(미래봉 존재) 최소 표본수
const SIGNAL_KPI_KEEP_WR = 0.52;
const SIGNAL_KPI_KEEP_EV = 0.001; // % 단위(예: 0.001 = 0.001%)
const SIGNAL_KPI_DROP_EV = -0.001;

// Trade KPI 기본 파라미터
const KPI_MIN_N_DEFAULT = 18;

module.exports = {
  SCHEMA_VERSION,
  TF_60M,
  BAR_INTERVAL_MS_60M,
  TF_15M,
  BAR_INTERVAL_MS_15M,
  SIGNAL_EVAL_VERSION,
  SIGNAL_EVAL_HORIZON_BARS,
  SIGNAL_KPI_MIN_N,
  SIGNAL_KPI_MIN_EVAL_N,
  SIGNAL_KPI_KEEP_WR,
  SIGNAL_KPI_KEEP_EV,
  SIGNAL_KPI_DROP_EV,
  KPI_MIN_N_DEFAULT,
};
