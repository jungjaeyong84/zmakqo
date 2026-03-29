-- Firestore cost guard query (KST).
-- Usage:
-- bq query --use_legacy_sql=false --format=prettyjson < ops/cost_guard.sql

DECLARE threshold_krw FLOAT64 DEFAULT 5000;
DECLARE lookback_days INT64 DEFAULT 14;

CREATE TEMP TABLE firestore_sku AS
SELECT
  DATE(usage_start_time, "Asia/Seoul") AS day_kst,
  FORMAT_TIMESTAMP("%Y-%m-%d %H:00", usage_start_time, "Asia/Seoul") AS hour_kst,
  sku.description AS sku,
  SUM(usage.amount) AS usage_amount,
  SUM(cost) AS cost_krw
FROM `donbeolja-dev.billing_export.gcp_billing_export_v1_01AF2F_588FE2_BCA6B7`
WHERE sku.description IN (
  "Cloud Firestore Read Ops Seoul",
  "Cloud Firestore Internet Data Transfer Out from APAC to APAC"
)
  AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL lookback_days DAY)
GROUP BY day_kst, hour_kst, sku;

CREATE TEMP TABLE daily AS
SELECT
  day_kst,
  SUM(IF(sku = "Cloud Firestore Read Ops Seoul", usage_amount, 0)) AS read_ops,
  SUM(IF(sku = "Cloud Firestore Read Ops Seoul", cost_krw, 0)) AS read_cost_krw,
  SUM(IF(sku = "Cloud Firestore Internet Data Transfer Out from APAC to APAC", usage_amount, 0)) AS transfer_bytes,
  SUM(IF(sku = "Cloud Firestore Internet Data Transfer Out from APAC to APAC", cost_krw, 0)) AS transfer_cost_krw
FROM firestore_sku
GROUP BY day_kst;

CREATE TEMP TABLE hourly AS
SELECT
  hour_kst,
  SUM(IF(sku = "Cloud Firestore Read Ops Seoul", usage_amount, 0)) AS read_ops,
  SUM(IF(sku = "Cloud Firestore Read Ops Seoul", cost_krw, 0)) AS read_cost_krw,
  SUM(IF(sku = "Cloud Firestore Internet Data Transfer Out from APAC to APAC", usage_amount, 0)) AS transfer_bytes,
  SUM(IF(sku = "Cloud Firestore Internet Data Transfer Out from APAC to APAC", cost_krw, 0)) AS transfer_cost_krw
FROM firestore_sku
GROUP BY hour_kst;

-- 1) Daily guard table (alert basis)
SELECT
  day_kst,
  ROUND(read_ops, 0) AS read_ops,
  ROUND(read_cost_krw, 2) AS read_cost_krw,
  ROUND(transfer_bytes, 0) AS transfer_bytes,
  ROUND(transfer_cost_krw, 2) AS transfer_cost_krw,
  ROUND(read_cost_krw + transfer_cost_krw, 2) AS firestore_total_krw,
  threshold_krw AS guard_threshold_krw,
  (read_cost_krw + transfer_cost_krw) >= threshold_krw AS guard_triggered
FROM daily
ORDER BY day_kst DESC;

-- 2) Hourly trend (last 72h for burst triage)
SELECT
  hour_kst,
  ROUND(read_ops, 0) AS read_ops,
  ROUND(read_cost_krw, 2) AS read_cost_krw,
  ROUND(transfer_bytes, 0) AS transfer_bytes,
  ROUND(transfer_cost_krw, 2) AS transfer_cost_krw,
  ROUND(read_cost_krw + transfer_cost_krw, 2) AS firestore_total_krw
FROM hourly
WHERE PARSE_TIMESTAMP("%Y-%m-%d %H:00", hour_kst, "Asia/Seoul")
  >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 72 HOUR)
ORDER BY hour_kst DESC;
