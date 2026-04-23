const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const { buildControlPlaneRouteModel } = require("../utils/controlPlaneViewModels");

const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function readTextSafe(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    return fallback;
  }
}

function renderControlPlane(pageKey) {
  return (req, res) => {
    const model = buildControlPlaneRouteModel(pageKey, req.query || {});
    return res.render("control-plane", { model });
  };
}

router.get("/dashboard/strategy-latest", (req, res) => {
  const period = String(req.query.period || "daily").trim().toLowerCase();
  const allowed = new Set(["daily", "weekly", "monthly"]);
  if (!allowed.has(period)) {
    return res.status(400).send("invalid period");
  }

  const titleMap = {
    daily: "일간 계획",
    weekly: "주간 전략",
    monthly: "월간 전략",
  };
  const jsonPath = path.join(OPS_DAILY_DIR, `objective_${period}_strategy_latest.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `objective_${period}_strategy_latest.md`);
  const latest = readJsonSafe(jsonPath, null);
  const markdown = readTextSafe(mdPath, "");

  return res.render("strategy-latest", {
    model: {
      active: "recovery",
      title: titleMap[period],
      period,
      latest,
      markdown,
      exists: Boolean(latest),
    },
  });
});

router.get("/dashboard/recovery", renderControlPlane("recovery"));
router.get("/dashboard/deployment", renderControlPlane("deployment"));
router.get("/dashboard/execution", renderControlPlane("execution"));
router.get("/dashboard/server-primary", renderControlPlane("server-primary"));
router.get("/dashboard/audit", renderControlPlane("audit"));

module.exports = router;
