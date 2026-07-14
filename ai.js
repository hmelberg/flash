// KI-klient uten SDK-avhengighet. Ett grensesnitt, to leverandørstier:
//   anthropic — api.anthropic.com (direkte nettleserkall, som før)
//   openai    — enhver OpenAI-kompatibel /chat/completions (OpenRouter, Gemini,
//               Groq, Ollama …). api.openai.com direkte mangler CORS og virker
//               ikke fra nettleser — bruk OpenRouter e.l.
// body er Anthropic-formet ({model, max_tokens, system, messages}); openai-stien
// oversetter. Svar normaliseres til {content:[{type:"text",text}], stop_reason}.

export function aiError(e) {
  const st = e?.status ?? e?.response?.status;
  if (st === 401) return "The API key was rejected — check your settings.";
  if (st === 429) return "Too many requests — wait a moment and try again.";
  return e.message || String(e);
}

async function readSse(r, onEvent) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      let ev; try { ev = JSON.parse(data); } catch { continue; }
      onEvent(ev);
    }
  }
}

async function httpJson(url, headers, bodyObj, signal) {
  const r = await fetch(url, {
    method: "POST", signal,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(bodyObj),
  });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r;
}

async function anthropicMessage({ apiKey }, body, { onText, signal } = {}) {
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const r = await httpJson("https://api.anthropic.com/v1/messages", headers,
    onText ? { ...body, stream: true } : body, signal);
  if (!onText) return await r.json();
  let text = "", stop = null;
  await readSse(r, (ev) => {
    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
      text += ev.delta.text; onText(ev.delta.text);
    } else if (ev.type === "message_delta") stop = ev.delta?.stop_reason ?? stop;
  });
  return { content: [{ type: "text", text }], stop_reason: stop };
}

async function openaiMessage({ apiKey, aiBaseUrl }, body, { onText, signal } = {}) {
  if (!aiBaseUrl) throw new Error("Set the base URL for the OpenAI-compatible service in settings (e.g. https://openrouter.ai/api/v1).");
  const url = aiBaseUrl.replace(/\/$/, "") + "/chat/completions";
  const oaBody = {
    model: body.model, max_tokens: body.max_tokens,
    messages: [...(body.system ? [{ role: "system", content: body.system }] : []), ...body.messages],
    ...(onText ? { stream: true } : {}),
  };
  const r = await httpJson(url, { Authorization: `Bearer ${apiKey}` }, oaBody, signal);
  if (!onText) {
    const j = await r.json();
    const c = j.choices?.[0];
    return { content: [{ type: "text", text: c?.message?.content || "" }], stop_reason: c?.finish_reason ?? null };
  }
  let text = "", stop = null;
  await readSse(r, (ev) => {
    const c = ev.choices?.[0];
    if (c?.delta?.content) { text += c.delta.content; onText(c.delta.content); }
    if (c?.finish_reason) stop = c.finish_reason;
  });
  return { content: [{ type: "text", text }], stop_reason: stop };
}

export async function aiMessage(cfg, body, opts = {}) {
  return cfg.aiProvider === "openai" ? openaiMessage(cfg, body, opts) : anthropicMessage(cfg, body, opts);
}
