const express = require("express");

function isV2Enabled() {
  return String(process.env.DONBEOLJA_V2_ENABLED || "0").trim() === "1";
}

function createSystemRoutes(stateMachine, scheduler) {
  const router = express.Router();

  router.get("/system", (req, res) => {
    res.json(stateMachine.getState());
  });

  // RUNNING: 상태 전환 + 스케줄러 자동 시작
  const _run = (req, res) => {
    if (isV2Enabled()) {
      return res.status(410).json({
        ok: false,
        reason: "V2_LEGACY_SYSTEM_RUN_DISABLED",
        replacement: "OPENCLAW_CRON_AND_V2_PROMOTION_GATE",
      });
    }
    const state = stateMachine.setState(stateMachine.STATES.RUNNING, "manual_run");
    const sched = (scheduler && typeof scheduler.start === "function") ? scheduler.start() : { ok: false, error: "NO_START" };
    res.json({
      ...state,
      scheduler: sched
    });
  };

  router.get("/system/run", _run);
  router.post("/system/run", _run);

  // [PATCH-55B] HALTED: 재용 컨펌 필수 — confirm=true 없으면 거부
  const _halt = (req, res) => {
    if (isV2Enabled()) {
      return res.status(410).json({
        ok: false,
        reason: "V2_LEGACY_SYSTEM_HALT_DISABLED",
        replacement: "V2_RUNBOOK_HALT_AND_CLOUD_RUN_TRAFFIC_CONTROL",
      });
    }
    const confirm = req.body && req.body.confirm === true;
    const source = (req.body && req.body.source) || req.query.source || "unknown";
    if (!confirm) {
      return res.status(403).json({
        ok: false,
        error: "HALT_REQUIRES_JAEYONG_CONFIRM",
        message: "거래 중지는 재용 컨펌 후에만 실행 가능합니다. confirm=true를 전달하세요.",
        source,
      });
    }
    const state = stateMachine.setState(stateMachine.STATES.HALTED, `manual_halt_confirmed_by_${source}`);
    const sched = (scheduler && typeof scheduler.stop === "function") ? scheduler.stop() : { ok: false, error: "NO_STOP" };
    res.json({
      ...state,
      scheduler: sched,
      confirmed_by: source,
    });
  };

  router.get("/system/halt", _halt);
  router.post("/system/halt", _halt);

  return router;
}

module.exports = createSystemRoutes;
