function shouldUseResponses(model) {
  const m = String(model || "");
  if (process.env.OPENAI_USE_RESPONSES === "1") return true;
  return m.startsWith("gpt-5");
}

function extractResponseText(json) {
  if (!json) return "";
  if (typeof json.output_text === "string") return json.output_text.trim();
  const output = Array.isArray(json.output) ? json.output : [];
  const chunks = [];
  for (const item of output) {
    if (!item) continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (!c) continue;
        if (c.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
        if (typeof c.text === "string" && !c.type) chunks.push(c.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

async function callOpenAI({
  apiKey,
  model,
  prompt,
  system = "You are a risk-aware quant assistant. Return JSON only.",
  temperature = 0.2,
  maxTokens = 600,
  jsonMode = true,
  reasoningEffort = null,
} = {}) {
  const out = { ok: false, reason: null, text: null, raw: null };
  if (!apiKey) {
    out.reason = "NO_API_KEY";
    return out;
  }
  if (!prompt) {
    out.reason = "NO_PROMPT";
    return out;
  }

  try {
    const useResponses = shouldUseResponses(model);
    if (useResponses) {
      const payload = {
        model: model || "gpt-5.2",
        temperature,
        max_output_tokens: maxTokens,
        input: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      };
      if (reasoningEffort) {
        payload.reasoning = { effort: String(reasoningEffort).trim().toLowerCase() };
      }
      if (jsonMode) {
        payload.text = { format: { type: "json_object" } };
      }
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = json && json.error && json.error.message ? json.error.message : "";
        out.reason = `HTTP_${res.status}${msg ? ":" + msg.slice(0, 160) : ""}`;
        out.raw = json;
        return out;
      }
      const text = extractResponseText(json);
      out.ok = true;
      out.text = text;
      out.raw = json;
      return out;
    }

    const payload = {
      model: model || "gpt-4o-mini",
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    };
    if (jsonMode) {
      payload.response_format = { type: "json_object" };
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      out.reason = `HTTP_${res.status}`;
      return out;
    }
    const json = await res.json();
    const text = json && json.choices && json.choices[0] && json.choices[0].message
      ? String(json.choices[0].message.content || "").trim()
      : "";
    out.ok = true;
    out.text = text;
    out.raw = json;
    return out;
  } catch (e) {
    out.reason = e && e.message ? e.message : String(e);
    return out;
  }
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

module.exports = { callOpenAI, safeJsonParse };
