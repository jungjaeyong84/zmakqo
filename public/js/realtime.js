/**
 * realtime.js - SSE (Server-Sent Events) client for donbeolja dashboard
 *
 * Tries SSE first; falls back to polling (doPulse/setInterval) after
 * 3 consecutive connection errors.
 */
(function (root) {
  "use strict";

  var MAX_SSE_ERRORS = 3;

  // ── helpers ──────────────────────────────────────────
  function eventKoJs(e) {
    var s = String(e || "").toUpperCase();
    if (s === "LONG") return "\uB9E4\uC218";
    if (s === "SHORT") return "\uB9E4\uB3C4";
    if (s.indexOf("EXIT") !== -1 || s.indexOf("TP") !== -1 || s.indexOf("SL") !== -1) return "\uCCAD\uC0B0";
    return s || "-";
  }

  function eventClassJs(e) {
    var s = String(e || "").toUpperCase();
    if (s === "LONG") return "long";
    if (s === "SHORT") return "short";
    return "";
  }

  function statusKoJs(st) {
    if (!st) return "\uC218\uC2E0\uB428";
    var s = String(st).toUpperCase();
    if (s === "PENDING") return "\uB300\uAE30 \uC911";
    if (s === "FILLED") return "\uCCB4\uACB0\uB428";
    return s;
  }

  function statusClassJs(st) {
    var k = statusKoJs(st);
    if (k === "\uCCB4\uACB0\uB428") return "success";
    if (k === "\uC2E4\uD328" || k === "\uC624\uB958") return "error";
    if (k === "\uAC74\uB108\uB6F0" || k === "\uCDE8\uC18C\uB428") return "warning";
    return "filled";
  }

  function fmtTimeJs(iso) {
    if (!iso) return "-";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "-";
    d = new Date(d.getTime() + 9 * 3600000);
    var mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    var dd = String(d.getUTCDate()).padStart(2, "0");
    var hh = String(d.getUTCHours()).padStart(2, "0");
    var mi = String(d.getUTCMinutes()).padStart(2, "0");
    return mm + "-" + dd + " " + hh + ":" + mi;
  }

  function fmtPrice(x) {
    if (x == null) return "-";
    var n = Number(x);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── DOM update ───────────────────────────────────────
  function applyData(j) {
    // signals table
    var sigTbody = document.querySelector(".home-signals-tbody");
    if (sigTbody && j.signals && j.signals.length) {
      var html = "";
      j.signals.forEach(function (s) {
        var sym = (s.symbol || "-").replace("USDT", "");
        var evCls = eventClassJs(s.event);
        var stCls = statusClassJs(s.status);
        html += "<tr>"
          + '<td class="mono text-muted" style="font-size:11px">' + fmtTimeJs(s.created_at) + "</td>"
          + '<td><strong style="font-size:12px">' + sym + "</strong></td>"
          + '<td><span class="chip sm ' + evCls + '">' + eventKoJs(s.event) + "</span></td>"
          + '<td><span class="chip sm ' + stCls + '">' + statusKoJs(s.status) + "</span></td>"
          + "</tr>";
      });
      sigTbody.innerHTML = html;
    }

    // fills table
    var fillTbody = document.querySelector(".home-fills-tbody");
    if (fillTbody && j.fills && j.fills.length) {
      var fhtml = "";
      j.fills.forEach(function (f) {
        var sym = (f.symbol || "-").replace("USDT", "");
        var evCls = eventClassJs(f.event);
        fhtml += "<tr>"
          + '<td class="mono text-muted" style="font-size:11px">' + fmtTimeJs(f.created_at) + "</td>"
          + '<td><strong style="font-size:12px">' + sym + "</strong></td>"
          + '<td><span class="chip sm ' + evCls + '">' + eventKoJs(f.event) + "</span></td>"
          + '<td class="mono" style="text-align:right">' + fmtPrice(f.exec_price) + "</td>"
          + "</tr>";
      });
      fillTbody.innerHTML = fhtml;
    }

    // pulse timestamp
    var pulseTime = document.getElementById("pulse-time");
    if (pulseTime && j.ts) {
      pulseTime.textContent = fmtTimeJs(j.ts) + " \uAC31\uC2E0";
    }
  }

  // ── SSE connect ──────────────────────────────────────
  function initRealtime(exchange) {
    exchange = String(exchange || "BINANCEFUT").toUpperCase();
    var errorCount = 0;
    var es = null;
    var fallbackInterval = null;

    // polling fallback (reuses the existing /api/dashboard/pulse endpoint)
    var POLL_MS = 30000;
    var pulseUrl = "/api/dashboard/pulse?exchange=" + encodeURIComponent(exchange);
    var lastPulseTs = "";

    function doPulse() {
      fetch(pulseUrl, { credentials: "include" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.ok || j.ts === lastPulseTs) return;
          lastPulseTs = j.ts;
          applyData(j);
        })
        .catch(function () {});
    }

    function startPollingFallback() {
      if (fallbackInterval) return;
      console.log("[realtime] SSE failed, falling back to polling every " + (POLL_MS / 1000) + "s");
      doPulse();
      fallbackInterval = setInterval(doPulse, POLL_MS);
    }

    function connectSSE() {
      var url = "/api/sse/dashboard?exchange=" + encodeURIComponent(exchange);
      es = new EventSource(url);

      es.onmessage = function (evt) {
        errorCount = 0; // reset on successful message
        try {
          var data = JSON.parse(evt.data);
          if (data && data.ok !== false) {
            applyData(data);
          }
        } catch (_) {}
      };

      es.onerror = function () {
        errorCount++;
        if (errorCount >= MAX_SSE_ERRORS) {
          if (es) { es.close(); es = null; }
          startPollingFallback();
        }
      };
    }

    // If EventSource is supported, try SSE; otherwise go straight to polling
    if (typeof EventSource !== "undefined") {
      connectSSE();
    } else {
      startPollingFallback();
    }
  }

  // expose globally
  root.initRealtime = initRealtime;
})(window);
