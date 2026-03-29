// Simple smoke tests (no external deps)
// - Validates app boot, core routes rendering, basic JSON endpoints.
// - Avoids Firestore/network heavy calls (CI/local friendly).

const http = require("http");

function httpGet(base, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = http.request(
      {
        method: "GET",
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + (url.search || ""),
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function bodyContainsAny(body, patterns = []) {
  const text = String(body || "");
  return patterns.some((p) => text.includes(String(p)));
}

(async () => {
  try {
    process.env.NODE_ENV = "development";
    process.env.RUNTIME_MODE = "local";
    process.env.ALLOW_LOCAL_NO_OAUTH = "1";
    process.env.SCHEDULER_TOKEN = "test_token";

    const { createApp } = require("../server/app");
    const app = createApp();

    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    // 1) Health
    const h = await httpGet(base, "/health");
    if (h.status !== 200 || !h.body.includes('"ok":true')) {
      throw new Error("health failed: " + h.status + " " + h.body.slice(0, 200));
    }

    // 2) Analysis hub render
    const a = await httpGet(base, "/dashboard/analysis");
    if (a.status !== 200 || !a.body.includes("데이터 신선도")) {
      throw new Error("analysis render failed: " + a.status);
    }

    // 3) Settings render (risk tab)
    const s = await httpGet(base, "/dashboard/settings?tab=risk");
    const settingsOk = bodyContainsAny(s.body, [
      // legacy EN copy
      "Risk Budget",
      // current KO copy
      "리스크 설정",
      // stable route marker inside risk card
      "/api/settings/risk-budget",
    ]);
    if (s.status !== 200 || !settingsOk) {
      throw new Error("settings render failed: " + s.status);
    }

    // 4) Trading alias route should render (will fail if Firestore is required)
    // We intentionally DO NOT call /dashboard/trading here.

    // 5) Scheduler status should be reachable in local no-oauth mode
    const st = await httpGet(base, "/scheduler/status", { "x-scheduler-token": "test_token" });
    if (st.status !== 200 || !st.body.includes('"ok":true')) {
      throw new Error("scheduler status failed: " + st.status + " " + st.body.slice(0, 200));
    }

    // 6) Legacy redirect
    const legacy = await httpGet(base, "/ui/settings/risk");
    if (legacy.status !== 302) {
      throw new Error("legacy risk redirect failed: " + legacy.status);
    }

    // 7) 404 JSON
    const nf = await httpGet(base, "/this-route-should-not-exist");
    if (nf.status !== 404 || !nf.body.includes('"NOT_FOUND"')) {
      throw new Error("404 failed: " + nf.status + " " + nf.body.slice(0, 200));
    }

    server.close();
    console.log("SMOKE_TESTS_OK");
    process.exit(0);
  } catch (e) {
    console.error("SMOKE_TESTS_FAIL:", e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
