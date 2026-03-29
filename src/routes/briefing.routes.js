const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");

function allowLocalNoOauth() {
  return String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
}

// 원래는 scheduler token 기반으로 보호하려던 라우트였지만,
// 로컬 개발에서는 OAuth 미구성 상태로도 페이지를 볼 수 있게 우회한다.
function requireSchedulerToken(req, res, next) {
  if (allowLocalNoOauth()) return next();

  const required = String(process.env.SCHEDULER_TOKEN || process.env.SCHEDULER_TOKEN_HASH || "");
  const got = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");

  if (!required || got !== required) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  return next();
}

// GET /briefing  (UI page)
router.get("/briefing", (req, res) => {
  // 로컬이면 바로 렌더
  if (allowLocalNoOauth()) {
    return res.render("briefing");
  }
  // 운영이면 세션 로그인 필요 (ensureAuth는 app.js에서 걸린다)
  return res.render("briefing");
});

// POST /scheduler/briefing (if exists in your system later)
router.post("/scheduler/briefing", requireSchedulerToken, async (req, res) => {
  try {
    const db = getFirestore();
    const doc = await db.collection("kpi_latest").doc("overall").get();
    const data = doc.exists ? (doc.data() || {}) : {};
    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "BRIEFING_ERROR", message: e.message });
  }
});

module.exports = router;
