const fs = require("fs");
const path = require("path");

const PARAM_FILE = path.join(process.cwd(), "param_sets.json");

let cache = null;

function loadParamSets() {
  if (!fs.existsSync(PARAM_FILE)) {
    throw new Error("param_sets.json not found");
  }
  const raw = fs.readFileSync(PARAM_FILE, "utf-8");
  cache = JSON.parse(raw);
  return cache;
}

function getActiveParamSet() {
  if (!cache) loadParamSets();
  const activeId = cache.active_param_set_id;
  const set = cache.param_sets[activeId];
  if (!set) {
    throw new Error(`Active param set not found: ${activeId}`);
  }
  return { id: activeId, ...set };
}

function reloadParamSets() {
  cache = null;
  return getActiveParamSet();
}

module.exports = {
  loadParamSets,
  getActiveParamSet,
  reloadParamSets
};
