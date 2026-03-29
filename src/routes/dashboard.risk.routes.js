const express = require("express");
const router = express.Router();

// Settings are not part of the dashboard UI.
// Keep this route for backward compatibility and redirect to the settings page.
router.get("/dashboard/risk", (req, res) => {
  return res.redirect(302, "/ui/settings/risk");
});

module.exports = router;
