function getEnv(env, key, fallback = "") {
  const v = env[key];
  return (v === undefined || v === null || v === "") ? fallback : String(v);
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function flagOn(env, key, def = "0") {
  const s = getEnv(env, key, def).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function addCheck(list, { id, ok, level, value, message }) {
  list.push({ id, ok: !!ok, level, value, message });
}

function checkSchedulerEnv(env = process.env) {
  const checks = [];
  const runtimeMode = getEnv(env, "RUNTIME_MODE", "");
  const nodeEnv = getEnv(env, "NODE_ENV", "");
  const isProd = runtimeMode === "prod" || nodeEnv === "production";

  const baseUrl = getEnv(env, "BASE_URL", "http://localhost:3000");
  const schedulerToken = getEnv(env, "SCHEDULER_TOKEN", "");
  const autoEval = flagOn(env, "AUTO_EVAL_LATEST", "1");
  const autoWeekly = flagOn(env, "AUTO_WEEKLY_CLOSE", "0");
  const autoAiAlloc = flagOn(env, "AUTO_AI_ALLOCATION", "0");

  const pollMs = toNum(getEnv(env, "SCHEDULER_POLL_MS", "300000"));
  const graceMs = toNum(getEnv(env, "SCHEDULER_GRACE_MS", "15000"));
  const autoEvalCheckMs = toNum(getEnv(env, "AUTO_EVAL_LATEST_CHECK_MS", "21600000"));
  const autoEvalMaxAgeMs = toNum(getEnv(env, "AUTO_EVAL_LATEST_MAX_AGE_MS", "86400000"));
  const autoWeeklyCheckMs = toNum(getEnv(env, "AUTO_WEEKLY_CLOSE_CHECK_MS", "3600000"));
  const autoWeeklyMin = toNum(getEnv(env, "AUTO_WEEKLY_CLOSE_WINDOW_MIN", "5"));
  const autoWeeklyMax = toNum(getEnv(env, "AUTO_WEEKLY_CLOSE_WINDOW_MAX", "25"));
  const autoAiAllocCheckMs = toNum(getEnv(env, "AUTO_AI_ALLOCATION_CHECK_MS", "43200000"));

  addCheck(checks, {
    id: "BASE_URL",
    ok: baseUrl.startsWith("http"),
    level: "ERROR",
    value: baseUrl,
    message: "BASE_URL은 http(s)로 시작해야 합니다.",
  });
  if (isProd && baseUrl.includes("localhost")) {
    addCheck(checks, {
      id: "BASE_URL_LOCALHOST",
      ok: false,
      level: "WARN",
      value: baseUrl,
      message: "프로덕션에서 BASE_URL이 localhost로 설정됨.",
    });
  }

  addCheck(checks, {
    id: "SCHEDULER_TOKEN",
    ok: (!autoEval && !autoWeekly && !autoAiAlloc) ? true : schedulerToken.length >= 8,
    level: "ERROR",
    value: schedulerToken ? "(set)" : "(empty)",
    message: "자동 평가/주간 마감/AI 배분 사용 시 SCHEDULER_TOKEN 필요.",
  });

  addCheck(checks, {
    id: "AUTO_EVAL_LATEST",
    ok: true,
    level: "INFO",
    value: autoEval ? "ON" : "OFF",
    message: "자동 평가 활성화 여부.",
  });
  addCheck(checks, {
    id: "AUTO_EVAL_LATEST_CHECK_MS",
    ok: autoEvalCheckMs !== null && autoEvalCheckMs >= 3600000,
    level: "WARN",
    value: autoEvalCheckMs,
    message: "너무 짧으면 비용/부하 증가. 권장 1h 이상.",
  });
  addCheck(checks, {
    id: "AUTO_EVAL_LATEST_MAX_AGE_MS",
    ok: autoEvalMaxAgeMs !== null && autoEvalMaxAgeMs >= 3600000,
    level: "WARN",
    value: autoEvalMaxAgeMs,
    message: "너무 짧으면 재평가가 과도할 수 있음.",
  });
  if (autoEval && autoEvalCheckMs !== null && autoEvalMaxAgeMs !== null && autoEvalMaxAgeMs < autoEvalCheckMs) {
    addCheck(checks, {
      id: "AUTO_EVAL_AGE_LT_CHECK",
      ok: false,
      level: "WARN",
      value: `${autoEvalMaxAgeMs} < ${autoEvalCheckMs}`,
      message: "MAX_AGE_MS가 CHECK_MS보다 작음.",
    });
  }

  addCheck(checks, {
    id: "AUTO_WEEKLY_CLOSE",
    ok: true,
    level: "INFO",
    value: autoWeekly ? "ON" : "OFF",
    message: "주간 마감 자동 실행 여부.",
  });
  addCheck(checks, {
    id: "AUTO_AI_ALLOCATION",
    ok: true,
    level: "INFO",
    value: autoAiAlloc ? "ON" : "OFF",
    message: "AI 배분 자동 실행 여부.",
  });
  addCheck(checks, {
    id: "AUTO_AI_ALLOCATION_CHECK_MS",
    ok: autoAiAllocCheckMs !== null && autoAiAllocCheckMs >= 3600000,
    level: "WARN",
    value: autoAiAllocCheckMs,
    message: "너무 짧으면 비용/부하 증가. 권장 1h 이상.",
  });
  addCheck(checks, {
    id: "AUTO_WEEKLY_CLOSE_CHECK_MS",
    ok: autoWeeklyCheckMs !== null && autoWeeklyCheckMs >= 3600000,
    level: "WARN",
    value: autoWeeklyCheckMs,
    message: "너무 짧으면 비용/부하 증가. 권장 1h 이상.",
  });
  addCheck(checks, {
    id: "AUTO_WEEKLY_CLOSE_WINDOW_MIN/MAX",
    ok: autoWeeklyMin !== null && autoWeeklyMax !== null && autoWeeklyMin <= autoWeeklyMax,
    level: "WARN",
    value: `${autoWeeklyMin}/${autoWeeklyMax}`,
    message: "윈도우 범위가 역전되면 주간 마감이 동작하지 않음.",
  });

  addCheck(checks, {
    id: "SCHEDULER_POLL_MS",
    ok: pollMs !== null && pollMs >= 60000,
    level: "WARN",
    value: pollMs,
    message: "너무 짧으면 비용 증가. 권장 60s 이상.",
  });
  addCheck(checks, {
    id: "SCHEDULER_GRACE_MS",
    ok: graceMs !== null && graceMs >= 5000,
    level: "WARN",
    value: graceMs,
    message: "너무 짧으면 중복 실행 위험.",
  });

  const errors = checks.filter((c) => !c.ok && c.level === "ERROR");
  const warns = checks.filter((c) => !c.ok && c.level === "WARN");

  return {
    checks,
    errors,
    warns,
    meta: {
      runtime_mode: runtimeMode,
      node_env: nodeEnv,
      is_prod: isProd,
    },
  };
}

function formatSchedulerEnvReport(result) {
  const lines = [];
  lines.push("Scheduler Env Check");
  lines.push(`mode=${result.meta.runtime_mode || "-"} node_env=${result.meta.node_env || "-"}`);
  lines.push("");
  for (const c of result.checks) {
    const status = c.ok ? "OK" : c.level;
    lines.push(`[${status}] ${c.id} = ${c.value} :: ${c.message}`);
  }
  lines.push("");
  lines.push(`Summary: errors=${result.errors.length}, warns=${result.warns.length}`);
  return { lines };
}

module.exports = { checkSchedulerEnv, formatSchedulerEnvReport };
