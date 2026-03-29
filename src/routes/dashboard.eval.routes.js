const express = require("express");
const router = express.Router();

router.get("/dashboard/eval", async (req, res) => {
  return res.render("eval");
});

module.exports = router;
