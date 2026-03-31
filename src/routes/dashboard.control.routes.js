const express = require("express");
const router = express.Router();
const { buildControlPlaneRouteModel } = require("../utils/controlPlaneViewModels");

function renderControlPlane(pageKey) {
  return (req, res) => {
    const model = buildControlPlaneRouteModel(pageKey);
    return res.render("control-plane", { model });
  };
}

router.get("/dashboard/recovery", renderControlPlane("recovery"));
router.get("/dashboard/deployment", renderControlPlane("deployment"));
router.get("/dashboard/execution", renderControlPlane("execution"));
router.get("/dashboard/server-primary", renderControlPlane("server-primary"));
router.get("/dashboard/audit", renderControlPlane("audit"));

module.exports = router;
