const API_BASE = "https://battlemetrics.ru/api/v1";
const ALLOWED_ORIGIN = "https://sayzedev.github.io";

function cors(origin) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(data, status, origin, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=15",
      ...cors(origin),
      ...extra
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405, origin);
    }
    if (!env.BATTLEMETRICS_API_KEY) {
      return json({ error: "api_key_not_configured", message: "Добавь BATTLEMETRICS_API_KEY в секреты Worker." }, 503, origin);
    }

    let endpoint;
    if (url.pathname === "/api/servers") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
      const page = Math.max(1, Math.min(100, Number(url.searchParams.get("page") || 1)));
      const params = new URLSearchParams({ game: "rust", per_page: "20", page: String(page), sort: "players" });
      if (q.length >= 3) params.set("q", q);
      endpoint = "/servers?" + params.toString();
    } else {
      const match = url.pathname.match(/^\/api\/servers\/(\d{1,12})$/);
      if (!match) return json({ error: "not_found" }, 404, origin);
      endpoint = "/servers/" + match[1];
    }

    try {
      const upstream = await fetch(API_BASE + endpoint, {
        headers: { "Authorization": "Bearer " + env.BATTLEMETRICS_API_KEY, "Accept": "application/json" },
        cf: { cacheTtl: 15, cacheEverything: true }
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=15",
          ...cors(origin)
        }
      });
    } catch {
      return json({ error: "upstream_unavailable", message: "Не удалось связаться с API серверов." }, 502, origin);
    }
  }
};
