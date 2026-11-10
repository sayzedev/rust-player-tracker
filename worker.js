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

    const statsMatch = url.pathname.match(/^\/api\/players\/(\d{17})\/stats$/);
    if (statsMatch) {
      if (!env.STEAM_API_KEY) {
        return json({ error: "steam_api_key_not_configured", message: "Добавь STEAM_API_KEY в секреты Worker." }, 503, origin);
      }
      const steamid = statsMatch[1];
      try {
        const params = new URLSearchParams({
          key: env.STEAM_API_KEY,
          steamid,
          include_appinfo: "0",
          include_played_free_games: "1",
          appids_filter: "252490",
          format: "json"
        });
        const upstream = await fetch("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?" + params.toString(), {
          headers: { "Accept": "application/json" },
          cf: { cacheTtl: 300, cacheEverything: true }
        });
        if (!upstream.ok) {
          return json({ error: "steam_stats_api_error", message: "Steam не вернул статистику: " + upstream.status }, 502, origin);
        }
        const data = await upstream.json();
        const response = data?.response;
        if (!response || !Array.isArray(response.games)) {
          return json({ available: false, message: "Статистика игр скрыта настройками приватности Steam или недоступна." }, 200, origin, "public, max-age=300");
        }
        const rust = response.games.find(game => Number(game.appid) === 252490);
        if (!rust) {
          return json({ available: true, owned_or_visible: false, message: "Steam не показывает Rust в списке игр этого профиля." }, 200, origin, "public, max-age=300");
        }
        return json({
          available: true,
          owned_or_visible: true,
          playtime_minutes: Number(rust.playtime_forever || 0),
          playtime_2weeks_minutes: Number(rust.playtime_2weeks || 0),
          last_played: rust.rtime_last_played ? Number(rust.rtime_last_played) : null
        }, 200, origin, "public, max-age=300");
      } catch {
        return json({ error: "steam_stats_unavailable", message: "Не удалось получить статистику Steam." }, 502, origin);
      }
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
