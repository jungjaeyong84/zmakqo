const express = require("express");
const router = express.Router();

router.get("/dashboard/briefing", async (req, res) => {
  return res.render("briefing");
});

module.exports = router;
