// Backward-compat shim: older code expects "../storage/cursor".
// The canonical implementation lives in ./cursors.js.
module.exports = require('./cursors');
