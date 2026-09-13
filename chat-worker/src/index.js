import { SYSTEM_PROMPT } from "./context.js";

// Only the website (and a local dev server) can call the bot from a browser.
// This keeps other sites from embedding it, but it isn't authentication:
// scripts can fake the Origin header, which is why the rate limit and length
// caps below exist too.
const SITE_ORIGIN = "https://mateotaylor.github.io";
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MAX_BODY_CHARS = 50_000;
const MAX_TURNS = 12;
const MAX_USER_CHARS = 500;
const MAX_REPLY_CHARS = 2_000;

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    if (origin !== SITE_ORIGIN && !LOCAL_ORIGIN.test(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (body, status = 200) => Response.json(body, { status, headers: cors });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: ip });
    if (!success) {
      return json({ error: "You're sending messages too quickly. Please wait a minute and try again." }, 429);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) {
      return json({ error: "This conversation is too long. Please refresh the page to start over." }, 413);
    }
    const contents = parseMessages(raw);
    if (!contents) {
      return json({ error: "Invalid request." }, 400);
    }

    const upstream = await fetch(`${GEMINI_URL}/${env.GEMINI_MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });

    if (upstream.status === 429) {
      return json({ error: "The chatbot has used up its free quota for now. Please try again later." }, 429);
    }
    if (!upstream.ok) {
      console.error("Gemini request failed", upstream.status, await upstream.text());
      return json({ error: "Something went wrong. Please try again." }, 502);
    }

    const data = await upstream.json();
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    return json({ reply: text || "Sorry, I can't help with that one." });
  },
};

// Turns the widget's {messages: [{role: "user" | "assistant", text}]} into
// Gemini `contents`, keeping only recent turns. Returns null if the shape is
// wrong or a visitor message is too long.
function parseMessages(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(body?.messages)) return null;

  const contents = [];
  for (const message of body.messages.slice(-MAX_TURNS)) {
    const text = typeof message?.text === "string" ? message.text.trim() : "";
    if (!text) return null;
    if (message.role === "user") {
      if (text.length > MAX_USER_CHARS) return null;
      contents.push({ role: "user", parts: [{ text }] });
    } else if (message.role === "assistant") {
      contents.push({ role: "model", parts: [{ text: text.slice(0, MAX_REPLY_CHARS) }] });
    } else {
      return null;
    }
  }

  // The conversation sent to Gemini should start and end with a visitor message.
  while (contents[0]?.role === "model") contents.shift();
  return contents.at(-1)?.role === "user" ? contents : null;
}
