const API_BASE = "https://battlemetrics.ru/api/v1";
const STEAM_API_BASE = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";
const ALLOWED_ORIGIN = "https://sayzedev.github.io";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function json(data, status, origin, cache = "no-store") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache,
      ...cors(origin)
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

    const playerMatch = url.pathname.match(/^\/api\/players\/(\d{17})$/);
    if (playerMatch) {
      if (!env.STEAM_API_KEY) {
        return json({ error: "steam_api_key_not_configured", message: "Добавь STEAM_API_KEY в секреты Worker." }, 503, origin);
      }
      const steamid = playerMatch[1];
      try {
        const params = new URLSearchParams({ key: env.STEAM_API_KEY, steamids: steamid, format: "json" });
        const upstream = await fetch(STEAM_API_BASE + "?" + params.toString(), {
          headers: { "Accept": "application/json" },
          cf: { cacheTtl: 60, cacheEverything: true }
        });
        if (!upstream.ok) {
          return json({ error: "steam_api_error", message: "Steam API вернул ошибку: " + upstream.status }, 502, origin);
        }
        const data = await upstream.json();
        const player = data?.response?.players?.[0];
        if (!player) return json({ error: "player_not_found", message: "Профиль Steam не найден или недоступен." }, 404, origin, "public, max-age=60");
        return json({
          steamid: player.steamid,
          personaname: player.personaname || "Steam игрок",
          profileurl: player.profileurl || ("https://steamcommunity.com/profiles/" + steamid),
          avatar: player.avatarfull || player.avatarmedium || player.avatar || "",
          personastate: Number(player.personastate ?? 0),
          gameid: player.gameid || "",
          gameextrainfo: player.gameextrainfo || ""
        }, 200, origin, "public, max-age=60");
      } catch {
        return json({ error: "steam_unavailable", message: "Не удалось связаться со Steam API." }, 502, origin);
      }
    }

    let endpoint;
    if (url.pathname === "/api/servers") {
      if (!env.BATTLEMETRICS_API_KEY) {
        return json({ error: "api_key_not_configured", message: "Добавь BATTLEMETRICS_API_KEY в секреты Worker." }, 503, origin);
      }
      const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
      const page = Math.max(1, Math.min(100, Number(url.searchParams.get("page") || 1)));
      const params = new URLSearchParams({ game: "rust", per_page: "20", page: String(page), sort: "players" });
      if (q.length >= 3) params.set("q", q);
      endpoint = "/servers?" + params.toString();
    } else {
      const match = url.pathname.match(/^\/api\/servers\/(\d{1,12})$/);
      if (!match) return json({ error: "not_found" }, 404, origin);
      if (!env.BATTLEMETRICS_API_KEY) {
        return json({ error: "api_key_not_configured", message: "Добавь BATTLEMETRICS_API_KEY в секреты Worker." }, 503, origin);
      }
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
