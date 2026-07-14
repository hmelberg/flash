import { test } from "node:test";
import assert from "node:assert/strict";
import { aiMessage, aiError } from "../ai.js";

const BODY = { model: "m", max_tokens: 100, system: "SYS", messages: [{ role: "user", content: "hei" }] };

function sseResponse(lines) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true, status: 200,
    body: { getReader: () => ({ read: async () =>
      i < lines.length ? { done: false, value: enc.encode(lines[i++] + "\n") } : { done: true } }) },
  };
}

test("anthropic: ikke-streamet kall med riktige headere", async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(opts.headers["x-api-key"], "K");
    assert.equal(opts.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(JSON.parse(opts.body).system, "SYS");
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "svar" }], stop_reason: "end_turn" }) };
  };
  const m = await aiMessage({ aiProvider: "anthropic", apiKey: "K" }, BODY);
  assert.equal(m.content[0].text, "svar");
});

test("anthropic: streaming samler tekst", async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(JSON.parse(opts.body).stream, true);
    return sseResponse([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"he"}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"i"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    ]);
  };
  let got = "";
  const m = await aiMessage({ aiProvider: "anthropic", apiKey: "K" }, BODY, { onText: t => got += t });
  assert.equal(got, "hei");
  assert.equal(m.content[0].text, "hei");
  assert.equal(m.stop_reason, "end_turn");
});

test("openai: oversetter body og normaliserer svar", async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(opts.headers.Authorization, "Bearer K");
    const b = JSON.parse(opts.body);
    assert.deepEqual(b.messages[0], { role: "system", content: "SYS" });
    assert.deepEqual(b.messages[1], { role: "user", content: "hei" });
    assert.equal(b.max_tokens, 100);
    return { ok: true, status: 200, json: async () =>
      ({ choices: [{ message: { content: "svar" }, finish_reason: "stop" }] }) };
  };
  const m = await aiMessage({ aiProvider: "openai", apiKey: "K", aiBaseUrl: "https://openrouter.ai/api/v1/" }, BODY);
  assert.equal(m.content[0].text, "svar");
  assert.equal(m.stop_reason, "stop");
});

test("openai: streaming (choices delta)", async () => {
  globalThis.fetch = async () => sseResponse([
    'data: {"choices":[{"delta":{"content":"he"}}]}',
    'data: {"choices":[{"delta":{"content":"i"},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    "data: [DONE]",
  ]);
  let got = "";
  const m = await aiMessage({ aiProvider: "openai", apiKey: "K", aiBaseUrl: "https://x/v1" }, BODY, { onText: t => got += t });
  assert.equal(got, "hei");
  assert.equal(m.stop_reason, "stop");
});

test("openai uten baseUrl gir forklarende feil; HTTP-feil får status", async () => {
  await assert.rejects(() => aiMessage({ aiProvider: "openai", apiKey: "K", aiBaseUrl: "" }, BODY), /base URL/i);
  globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(() => aiMessage({ aiProvider: "anthropic", apiKey: "K" }, BODY), (e) => e.status === 429);
});

test("aiError oversetter kjente statuser", () => {
  assert.match(aiError({ status: 401 }), /rejected/);
  assert.match(aiError({ status: 429 }), /Too many/);
  assert.equal(aiError(new Error("x")), "x");
});
