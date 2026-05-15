"use strict";

const http = require("http");
const { URL } = require("url");
const { loadV3ControlStatus } = require("../src/v3/controlPlane");

function json(res, code, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function htmlPage(status) {
  const badgeTone = status.status === "READY" ? "#137a4b" : status.status === "HOLD" ? "#b26a00" : "#b43224";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>DONBEOLJA V3 Local Control</title>
  <style>
    body{margin:0;background:#f5f2ea;color:#181511;font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Noto Sans KR",Segoe UI,sans-serif}
    .wrap{max-width:980px;margin:0 auto;padding:24px}
    .panel{background:#fffaf0;border:1px solid #ded4c2;border-radius:20px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
    h1{margin:0 0 8px;font-size:34px}
    .sub{color:#6f675b;font-size:14px;margin-bottom:18px}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .card{background:#fff;border:1px solid #e7dcc8;border-radius:16px;padding:16px}
    .k{font-size:12px;color:#6f675b;font-weight:700;text-transform:uppercase}
    .v{margin-top:8px;font-size:24px;font-weight:800}
    .pill{display:inline-block;margin-top:10px;padding:6px 10px;border-radius:999px;background:${badgeTone};color:#fff;font-size:12px;font-weight:700}
    pre{white-space:pre-wrap;background:#17130e;color:#efe7da;border-radius:14px;padding:14px;font-size:12px;overflow:auto}
    a{color:#2d5f8b;text-decoration:none}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="panel">
      <h1>DONBEOLJA V3 Local Control</h1>
      <div class="sub">v1/v2 서버를 거치지 않는 독립 로컬 v3 control plane입니다.</div>
      <div class="pill">${status.status} · ${status.reason}</div>
      <div class="grid" style="margin-top:16px">
        <div class="card"><div class="k">Learning Scope</div><div class="v">${status.learning_scope}</div></div>
        <div class="card"><div class="k">Source Lane</div><div class="v">${status.source_lane}</div></div>
        <div class="card"><div class="k">Bootstrap</div><div class="v">${status.bootstrap.retained_sample_n ?? "-"} / ${status.bootstrap.retained_win_rate_pct ?? "-"}%</div></div>
        <div class="card"><div class="k">Paper Performance</div><div class="v">${status.performance.today_closed_trade_n ?? 0} closed</div></div>
      </div>
      <p style="margin-top:16px"><a href="/api/v3/status">/api/v3/status</a></p>
      <pre>${escapeHtml(JSON.stringify(status, null, 2))}</pre>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(text) {
  return String(text || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
}

function buildServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const status = loadV3ControlStatus();

    if (url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        service: status.service,
        status: status.status,
        reason: status.reason,
        learning_scope: status.learning_scope,
        source_lane: status.source_lane,
      });
    }
    if (url.pathname === "/api/v3/status") return json(res, 200, status);
    if (url.pathname === "/api/v3/learning") return json(res, 200, status);
    if (url.pathname === "/api/v3/bootstrap") return json(res, 200, status.bootstrap);
    if (url.pathname === "/api/v3/lane") return json(res, 200, status.lane);
    if (url.pathname === "/api/v3/performance") return json(res, 200, status.performance);
    if (url.pathname === "/api/v3/validation") return json(res, 200, status.validation);
    if (url.pathname === "/" || url.pathname === "/dashboard" || url.pathname === "/v3") {
      const body = htmlPage(status);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(body) });
      return res.end(body);
    }
    return json(res, 404, { ok: false, reason: "V3_ROUTE_NOT_FOUND", path: url.pathname });
  });
}

function start() {
  const port = Math.max(1, Math.min(65535, Math.trunc(Number(process.env.PORT || 3000) || 3000)));
  const host = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
  const server = buildServer();
  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify({ ok: true, event: "V3_LOCAL_SERVER_READY", host, port, ts: new Date().toISOString() })}\n`);
  });
}

start();
