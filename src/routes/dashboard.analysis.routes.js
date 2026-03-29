const express = require("express");
const router = express.Router();

// Analysis hub (read-only).
router.get("/dashboard/analysis", async (req, res) => {
  return res.render("analysis");
});

module.exports = router;
