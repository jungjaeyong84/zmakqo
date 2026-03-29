const express = require("express");
const router = express.Router();

const { getFirestore } = require("../storage/firestore");

function requireSchedulerToken(req, res, next) {
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (!expected || token !== expected) {
    return res.status(403).json({ ok: false, error: "FORBIDDEN" });
  }
  return next();
}

// ✅ 기본 헬스
router.get("/health", (req, res) => {
  res.json({ ok: true, service: String(process.env.K_SERVICE || "donbeolja") });
});

// ✅ Firestore 헬스 (로그인 없이 접근 가능해야 함)
router.get("/health/firestore", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("ping").doc("ping").get();
    res.json({ ok: true, firestore: "OK", ping_exists: snap.exists });
  } catch (e) {
    res.status(500).json({
      ok: false,
      firestore: "FAIL",
      message: e?.message || String(e),
    });
  }
});

// ✅ Secrets/keys presence check (protected)
router.get("/health/keys", requireSchedulerToken, (req, res) => {
  const tail = (v) => {
    const s = String(v || "");
    if (!s) return null;
    return s.length >= 4 ? s.slice(-4) : s;
  };
  const present = (v) => {
    const s = String(v || "").trim();
    return s.length > 0;
  };
  res.json({
    ok: true,
    binancefut: {
      key_present: present(process.env.BINANCEFUT_API_KEY),
      secret_present: present(process.env.BINANCEFUT_API_SECRET),
      key_tail: tail(process.env.BINANCEFUT_API_KEY),
      secret_tail: tail(process.env.BINANCEFUT_API_SECRET),
    },
  });
});

module.exports = router;
