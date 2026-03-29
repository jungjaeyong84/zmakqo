const express = require("express");
const router = express.Router();
const { getLatestGateEvent } = require("../storage/gateEvents");

// 로컬 디버그 전용
router.get("/debug/latest-gate", async (req, res) => {
  try {
    const g = await getLatestGateEvent();
    res.json({ ok: true, latest_gate: g });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;
