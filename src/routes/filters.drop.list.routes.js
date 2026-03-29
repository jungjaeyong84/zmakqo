const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");

// GET /api/filters/drop
router.get("/api/filters/drop", async (req, res) => {
  try {
    const db = getFirestore();
    const snap = await db.collection("filters_drop").get();
    const rows = snap.docs.map(d => d.data() || {});
    rows.sort((a,b) => String(b.updated_at||"").localeCompare(String(a.updated_at||"")));
    return res.json({ ok:true, count: rows.length, rows });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"FILTERS_DROP_LIST_ERROR", message: e.message });
  }
});

module.exports = router;
