const API_BASE = "https://battlemetrics.ru/api/v1";
const STEAM_API_BASE = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/";
const ALLOWED_ORIGIN = "https://sayzedev.github.io";

const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const FRONTEND_URL = "https://sayzedev.github.io/rust-player-tracker/";

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
}
function fromB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}
async function signToken(payload, secret) {
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return encoded + "." + b64url(new Uint8Array(signature));
}
async function verifyToken(token, secret, purpose) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromB64url(parts[1]), new TextEncoder().encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    if (payload.purpose !== purpose || !Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

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

    if (url.pathname === "/auth/steam") {
      if (!env.STEAM_SESSION_SECRET) return json({ error: "steam_login_not_configured", message: "В Worker не добавлен секрет STEAM_SESSION_SECRET." }, 503, origin);
      const state = await signToken({ purpose: "state", nonce: b64url(crypto.getRandomValues(new Uint8Array(18))), exp: Math.floor(Date.now() / 1000) + 600 }, env.STEAM_SESSION_SECRET);
      const callback = new URL("/auth/steam/callback", url.origin);
      callback.searchParams.set("state", state);
      const auth = new URL(STEAM_OPENID);
      auth.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
      auth.searchParams.set("openid.mode", "checkid_setup");
      auth.searchParams.set("openid.return_to", callback.toString());
      auth.searchParams.set("openid.realm", url.origin);
      auth.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
      auth.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
      return Response.redirect(auth.toString(), 302);
    }

    if (url.pathname === "/auth/steam/callback") {
      if (!env.STEAM_SESSION_SECRET) return json({ error: "steam_login_not_configured" }, 503, origin);
      const state = url.searchParams.get("state") || "";
      const stateData = await verifyToken(state, env.STEAM_SESSION_SECRET, "state");
      if (!stateData) return json({ error: "steam_state_invalid", message: "Ссылка входа устарела. Попробуй войти снова." }, 400, origin);
      const expectedReturn = new URL("/auth/steam/callback", url.origin);
      expectedReturn.searchParams.set("state", state);
      const returnTo = url.searchParams.get("openid.return_to") || "";
      if (returnTo !== expectedReturn.toString() ||
          url.searchParams.get("openid.op_endpoint") !== STEAM_OPENID ||
          url.searchParams.get("openid.ns") !== "http://specs.openid.net/auth/2.0") {
        return json({ error: "steam_openid_invalid", message: "Steam вернул некорректный ответ авторизации." }, 400, origin);
      }
      const claimed = url.searchParams.get("openid.claimed_id") || "";
      let claimedUrl;
      try { claimedUrl = new URL(claimed); } catch { return json({ error: "steam_id_invalid" }, 400, origin); }
      const match = claimedUrl.hostname === "steamcommunity.com" && claimedUrl.pathname.match(/^\/openid\/id\/([0-9]{17})$/);
      if (!match) return json({ error: "steam_id_invalid" }, 400, origin);
      try {
        const verification = new URLSearchParams();
        for (const [key, value] of url.searchParams.entries()) {
          if (key.startsWith("openid.")) verification.append(key, value);
        }
        verification.set("openid.mode", "check_authentication");
        const checked = await fetch(STEAM_OPENID, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: verification.toString()
        });
        const body = await checked.text();
        if (!checked.ok || !/is_valid:true/i.test(body)) {
          return json({ error: "steam_signature_invalid", message: "Steam не подтвердил авторизацию." }, 401, origin);
        }
        const token = await signToken({ purpose: "session", steamid: match[1], exp: Math.floor(Date.now() / 1000) + 86400 }, env.STEAM_SESSION_SECRET);
        const redirect = new URL(FRONTEND_URL);
        redirect.searchParams.set("steam_login", token);
        return Response.redirect(redirect.toString(), 302);
      } catch {
        return json({ error: "steam_verification_unavailable", message: "Не удалось проверить ответ Steam." }, 502, origin);
      }
    }

    if (url.pathname === "/auth/steam/session") {
      if (!env.STEAM_SESSION_SECRET) return json({ error: "steam_login_not_configured" }, 503, origin);
      const token = url.searchParams.get("token") || "";
      const session = await verifyToken(token, env.STEAM_SESSION_SECRET, "session");
      if (!session || !/^[0-9]{17}$/.test(session.steamid || "")) return json({ error: "steam_session_invalid", message: "Сессия входа недействительна или истекла." }, 401, origin);
      return json({ steamid: session.steamid, expires_at: session.exp }, 200, origin, "no-store");
    }

    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405, origin);
    }

    const rustPlusMatch = url.pathname.match(/^\/api\/rustplus\/(status|map|markers|team|info)$/);
    if (rustPlusMatch) {
      const backendBase = String(env.RUSTPLUS_BACKEND_URL || "").trim().replace(/\/$/, "");
      const backendSecret = String(env.RUSTPLUS_BACKEND_SECRET || "");
      if (!backendBase || !backendSecret) {
        return json({
          service: "rustplus",
          auth_token_configured: Boolean(env.RUSTPLUS_AUTH_TOKEN),
          companion_connected: false,
          pairing_required: true,
          backend_configured: false,
          message: "Companion-сервис ещё не подключён. Нужны RUSTPLUS_BACKEND_URL и RUSTPLUS_BACKEND_SECRET в Cloudflare Worker."
        }, 200, origin, "no-store");
      }
      const route = rustPlusMatch[1];
      try {
        const upstream = await fetch(backendBase + "/api/rustplus/" + route, {
          headers: { "Authorization": "Bearer " + backendSecret, "Accept": "application/json" },
          signal: AbortSignal.timeout(15000)
        });
        const body = await upstream.text();
        if (route === "status" && upstream.ok) {
          let data = {};
          try { data = JSON.parse(body); } catch {}
          return json({
            service: "rustplus",
            auth_token_configured: Boolean(env.RUSTPLUS_AUTH_TOKEN),
            companion_connected: data.state === "connected",
            pairing_required: data.state === "pairing_data_missing" || data.state === "not_configured",
            backend_configured: true,
            state: data.state || "unknown",
            connected_at: data.connected_at || null,
            message: data.state === "connected"
              ? "Companion подключён к серверу Rust."
              : "Companion-сервис доступен, состояние: " + (data.state || "неизвестно") + "."
          }, 200, origin, "no-store");
        }
        return new Response(body, {
          status: upstream.status,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin) }
        });
      } catch {
        return json({
          service: "rustplus",
          companion_connected: false,
          backend_configured: true,
          error: "rustplus_backend_unavailable",
          message: "Не удалось связаться с Companion-сервисом. Проверь его запуск и адрес."
        }, 502, origin, "no-store");
      }
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
