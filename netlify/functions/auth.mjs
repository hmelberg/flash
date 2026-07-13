// Tilstandsløs OAuth-utveksling: client secrets bor i Netlify-miljøvariabler,
// ingenting lagres. GET gir klienten offentlig konfig (client-id-er).
const env = (k) => (globalThis.Netlify ? Netlify.env.get(k) : process.env[k]) || "";
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method === "GET") {
    return json({
      github_client_id: env("GITHUB_CLIENT_ID"),
      google_client_id: env("GOOGLE_CLIENT_ID"),
      google_api_key: env("GOOGLE_API_KEY"),
    });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "ugyldig JSON" }, 400); }

  if (body.provider === "github") {
    if (!body.code) return json({ error: "mangler code" }, 400);
    const r = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: env("GITHUB_CLIENT_ID"),
        client_secret: env("GITHUB_CLIENT_SECRET"),
        code: body.code,
      }),
    });
    const t = await r.json();
    if (!t.access_token) return json({ error: t.error_description || "GitHub avviste koden" }, 400);
    return json({ access_token: t.access_token });
  }

  if (body.provider === "google") {
    if (!body.code && !body.refresh_token) return json({ error: "mangler code/refresh_token" }, 400);
    const grant = body.refresh_token
      ? { grant_type: "refresh_token", refresh_token: body.refresh_token }
      : { grant_type: "authorization_code", code: body.code, redirect_uri: body.redirect_uri || "" };
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        ...grant,
      }).toString(),
    });
    const t = await r.json();
    if (!t.access_token) return json({ error: t.error_description || t.error || "Google avviste forespørselen" }, 400);
    return json({ access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in });
  }

  return json({ error: "ukjent provider" }, 400);
};

export const config = { path: "/api/auth" };
