/**
 * ShiftPro AI Assistant backend scaffold (Cloudflare Workers).
 * Configure OPENAI_API_KEY as a Worker secret; never put it in frontend files.
 * Configure ALLOWED_ORIGIN to the exact deployed app origin, e.g.
 * https://anamiir2-collab.github.io
 */
const MAX_MESSAGE_LENGTH = 2000;
const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : "";
}

function json(body, status, origin) {
  const headers = new Headers(JSON_HEADERS);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }});
    }

    const url = new URL(request.url);
    if (url.pathname !== "/api/assistant") return json({ error: "not_found" }, 404, origin);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
    if (!origin) return json({ error: "origin_not_allowed" }, 403, "");

    if (!env.OPENAI_API_KEY) return json({ error: "ai_not_configured" }, 503, origin);
    if (!env.ALLOWED_ORIGIN) return json({ error: "origin_not_configured" }, 503, origin);

    let body;
    try { body = await request.json(); }
    catch (_) { return json({ error: "invalid_json" }, 400, origin); }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const locale = body.locale === "en" ? "en" : "ar";
    if (!message) return json({ error: "message_required" }, 400, origin);
    if (message.length > MAX_MESSAGE_LENGTH) return json({ error: "message_too_long" }, 413, origin);

    const systemPrompt = [
      "You are ShiftPro Smart Assistant, a helpful assistant for a shift, attendance, payroll, reports, and personal wallet PWA.",
      "Respond in the user's selected language: Arabic (Egyptian-friendly, clear) or English.",
      "This deployment is a conversation-only scaffold. You cannot inspect app data, navigate the app, create wallets, record attendance, change payroll, or perform any other action.",
      "Never claim an action has been completed. Explain that actions are not enabled yet when asked to execute one.",
      "Never request passwords, API keys, PINs, or sensitive authentication data.",
      "For payroll or attendance questions, explain that you cannot see their local app data unless a future explicitly authorized integration supplies it.",
      "Be concise, ask a clarifying question when needed, and do not invent personal app data."
    ].join("\n");

    try {
      const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + env.OPENAI_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL || "gpt-4.1-mini",
          instructions: systemPrompt,
          input: message,
          max_output_tokens: 500,
          store: false
        })
      });

      const result = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        // Do not forward upstream details, request IDs, or secrets to the client.
        console.error("OpenAI request failed with status", upstream.status);
        return json({ error: upstream.status === 429 ? "rate_limited" : "upstream_error" }, upstream.status === 429 ? 429 : 502, origin);
      }

      const reply = typeof result.output_text === "string" ? result.output_text.trim() : "";
      if (!reply) return json({ error: "empty_reply" }, 502, origin);
      return json({ reply }, 200, origin);
    } catch (error) {
      console.error("Assistant upstream connection failed");
      return json({ error: "upstream_unavailable" }, 502, origin);
    }
  }
};
