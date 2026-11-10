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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
      const sessionToken = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const rustPlusSession = env.STEAM_SESSION_SECRET
        ? await verifyToken(sessionToken, env.STEAM_SESSION_SECRET, "session")
        : null;
      const pairedSteamId = String(env.RUSTPLUS_PLAYER_ID || "").trim();
      if (!rustPlusSession || !pairedSteamId || rustPlusSession.steamid !== pairedSteamId) {
        return json({
          error: "rustplus_auth_required",
          message: "Войди через Steam с аккаунтом, привязанным к Rust+."
        }, 401, origin);
      }
      if (env.RUSTPLUS_CLOUD) {
        const id = env.RUSTPLUS_CLOUD.idFromName("primary-rust-server");
        const stub = env.RUSTPLUS_CLOUD.get(id);
        const route = rustPlusMatch[1];
        const cloudResponse = await stub.fetch("https://rustplus-cloud.internal/" + route);
        const body = await cloudResponse.text();
        return new Response(body, {
          status: cloudResponse.status,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin) }
        });
      }
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
            error: data.error || null,
            message: data.state === "connected"
              ? "Companion подключён к серверу Rust."
              : data.state === "pairing_data_missing" || data.state === "not_configured"
                ? "Companion запущен, но данные привязки Rust+ ещё не настроены."
                : data.state === "connecting"
                  ? "Companion запущен и подключается к серверу Rust+."
                  : "Companion доступен, состояние: " + (data.state || "неизвестно") + "."
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


// Cloud-hosted Rust+ connection. Pairing values must be configured as Worker secrets.
function rpVarint(value) {
  let n = BigInt.asUintN(64, BigInt(value));
  const out = [];
  while (n > 127n) {
    out.push(Number((n & 127n) | 128n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}
function rpFieldVarint(field, value) {
  return [...rpVarint((field << 3) | 0), ...rpVarint(value)];
}
function rpFieldBytes(field, bytes) {
  return [...rpVarint((field << 3) | 2), ...rpVarint(bytes.length), ...bytes];
}
function rpRequest(seq, playerId, playerToken, requestField) {
  const body = [
    ...rpFieldVarint(1, seq),
    ...rpFieldVarint(2, BigInt(playerId)),
    ...rpFieldVarint(3, BigInt(playerToken)),
    ...rpFieldBytes(requestField, new Uint8Array())
  ];
  return new Uint8Array(body);
}
function rpDecode(bytes) {
  const fields = {};
  let i = 0;
  const readVarint = () => {
    let value = 0n, shift = 0n;
    while (i < bytes.length) {
      const b = bytes[i++];
      value |= BigInt(b & 127) << shift;
      if (!(b & 128)) return value;
      shift += 7n;
      if (shift > 70n) throw new Error("Invalid protobuf varint");
    }
    throw new Error("Truncated protobuf varint");
  };
  while (i < bytes.length) {
    const key = Number(readVarint());
    const field = key >> 3, wire = key & 7;
    let value;
    if (wire === 0) value = readVarint();
    else if (wire === 1) { value = bytes.slice(i, i + 8); i += 8; }
    else if (wire === 2) { const len = Number(readVarint()); value = bytes.slice(i, i + len); i += len; }
    else if (wire === 5) { value = bytes.slice(i, i + 4); i += 4; }
    else throw new Error("Unsupported protobuf wire type");
    (fields[field] ||= []).push({ wire, value });
  }
  return fields;
}
function rpOne(fields, n) { return fields[n]?.[0]?.value; }
function rpText(value) { return value ? new TextDecoder().decode(value) : ""; }
function rpFloat(value) {
  if (!value || value.length !== 4) return 0;
  return new DataView(value.buffer, value.byteOffset, 4).getFloat32(0, true);
}
function rpNumber(value) { return value === undefined ? 0 : Number(value); }
function rpDecodeResponse(buffer) {
  const outer = rpDecode(new Uint8Array(buffer));
  const responseBytes = rpOne(outer, 1);
  if (!responseBytes) return { type: "broadcast" };
  const response = rpDecode(responseBytes);
  if (rpOne(response, 5)) {
    const err = rpDecode(rpOne(response, 5));
    return { type: "error", error: rpText(rpOne(err, 1)) || "Rust+ rejected the request" };
  }
  if (rpOne(response, 6)) {
    const info = rpDecode(rpOne(response, 6));
    return { type: "info", info: {
      name: rpText(rpOne(info, 1)), header_image: rpText(rpOne(info, 2)),
      url: rpText(rpOne(info, 3)), map: rpText(rpOne(info, 4)),
      map_size: rpNumber(rpOne(info, 5)), wipe_time: rpNumber(rpOne(info, 6)),
      players: rpNumber(rpOne(info, 7)), max_players: rpNumber(rpOne(info, 8)),
      queued_players: rpNumber(rpOne(info, 9))
    }};
  }
  if (rpOne(response, 9)) {
    const team = rpDecode(rpOne(response, 9));
    return { type: "team", team: {
      leader_steam_id: String(rpOne(team, 1) || ""),
      members: (team[2] || []).map(x => {
        const m = rpDecode(x.value);
        return { steamid: String(rpOne(m, 1) || ""), name: rpText(rpOne(m, 2)),
          x: rpFloat(rpOne(m, 3)), y: rpFloat(rpOne(m, 4)),
          online: Boolean(rpOne(m, 5)), alive: Boolean(rpOne(m, 7)) };
      })
    }};
  }
  if (rpOne(response, 8)) {
    const map = rpDecode(rpOne(response, 8));
    const image = rpOne(map, 3);
    let binary = "";
    if (image) for (let i = 0; i < image.length; i += 0x8000) binary += String.fromCharCode(...image.subarray(i, i + 0x8000));
    return { type: "map", map: {
      width: rpNumber(rpOne(map, 1)), height: rpNumber(rpOne(map, 2)),
      image_data_url: image ? "data:image/jpeg;base64," + btoa(binary) : null,
      ocean_margin: rpNumber(rpOne(map, 4)),
      monuments: (map[5] || []).map(x => {
        const m = rpDecode(x.value);
        return { token: rpText(rpOne(m, 1)), x: rpFloat(rpOne(m, 2)), y: rpFloat(rpOne(m, 3)) };
      })
    }};
  }
  if (rpOne(response, 13)) {
    const markers = rpDecode(rpOne(response, 13));
    return { type: "markers", markers: (markers[1] || []).map(x => {
      const m = rpDecode(x.value);
      return { id: rpNumber(rpOne(m, 1)), type: rpNumber(rpOne(m, 2)),
        x: rpFloat(rpOne(m, 3)), y: rpFloat(rpOne(m, 4)),
        steamid: String(rpOne(m, 5) || ""), rotation: rpFloat(rpOne(m, 6)),
        radius: rpFloat(rpOne(m, 7)), name: rpText(rpOne(m, 11)) };
    })};
  }
  return { type: "unknown", seq: String(rpOne(response, 1) || "") };
}

export class RustPlusCloud {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ws = null;
    this.state = "not_configured";
    this.lastError = null;
    this.connectedAt = null;
    this.seq = 0;
    this.pending = new Map();
    this.lastInfo = null;
    this.lastTeam = null;
    this.lastMap = null;
    this.lastMarkers = null;
    this.connecting = false;
  }
  config() {
    const host = String(this.env.RUSTPLUS_SERVER_IP || "").trim();
    const port = Number(this.env.RUSTPLUS_APP_PORT || 0);
    const playerId = String(this.env.RUSTPLUS_PLAYER_ID || "").trim();
    const token = String(this.env.RUSTPLUS_PLAYER_TOKEN || "").trim();
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 ||
        !/^\d{17}$/.test(playerId) || !/^-?\d+$/.test(token)) return null;
    return { host, port, playerId, token };
  }
  async ensureConnected() {
    const cfg = this.config();
    if (!cfg) { this.state = "pairing_data_missing"; return; }
    if (this.ws && this.ws.readyState <= 1) return;
    if (this.connecting) return;
    this.connecting = true;
    this.state = "connecting";
    try {
      const ws = new WebSocket("ws://" + cfg.host + ":" + cfg.port);
      this.ws = ws;
      this.schedule();
      ws.addEventListener("open", () => {
        this.state = "connected";
        this.connectedAt = new Date().toISOString();
        this.lastError = null;
        this.sendRequest(8).catch(() => {});
        this.schedule();
      });
      ws.addEventListener("message", async event => {
        try {
          const data = event.data instanceof ArrayBuffer ? event.data : await event.data.arrayBuffer();
          const result = rpDecodeResponse(data);
          if (result.type === "error") {
            this.lastError = result.error;
            this.state = "auth_error";
          } else if (result.type === "info") this.lastInfo = result.info;
          else if (result.type === "team") this.lastTeam = result.team;
          else if (result.type === "map") this.lastMap = result.map;
          else if (result.type === "markers") this.lastMarkers = result.markers;
          const response = rpDecode(new Uint8Array(data));
          const inner = rpOne(response, 1);
          if (inner) {
            const parsed = rpDecode(inner);
            const seq = String(rpOne(parsed, 1) || "");
            const waiter = this.pending.get(seq);
            if (waiter) { this.pending.delete(seq); waiter(result); }
          }
        } catch (e) { this.lastError = String(e?.message || e).slice(0, 200); }
      });
      ws.addEventListener("error", () => {
        this.lastError = "WebSocket connection error";
        this.state = "error";
      });
      ws.addEventListener("close", () => {
        this.ws = null;
        this.connecting = false;
        if (this.state !== "auth_error") this.state = "disconnected";
        this.schedule();
      });
      this.connecting = false;
    } catch (e) {
      this.connecting = false;
      this.state = "error";
      this.lastError = String(e?.message || e).slice(0, 200);
      this.schedule();
    }
  }
  async sendRequest(field) {
    const cfg = this.config();
    if (!cfg || !this.ws || this.ws.readyState !== 1) throw new Error("Rust+ is not connected");
    const seq = ++this.seq;
    const packet = rpRequest(seq, cfg.playerId, cfg.token, field);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(String(seq)); reject(new Error("Rust+ request timeout")); }, 12000);
      this.pending.set(String(seq), result => { clearTimeout(timer); resolve(result); });
      this.ws.send(packet);
    });
  }
  schedule() {
    this.ctx.storage.setAlarm(Date.now() + 4 * 60 * 1000).catch(() => {});
  }
  async alarm() {
    if (!this.config()) { this.state = "pairing_data_missing"; return; }
    if (!this.ws || this.ws.readyState !== 1) {
      this.connecting = false;
      await this.ensureConnected();
    } else {
      try { await this.sendRequest(8); } catch { try { this.ws.close(); } catch {} }
      this.schedule();
    }
  }
  async fetch(request) {
    const path = new URL(request.url).pathname.replace(/^\//, "");
    if (path === "status" || path === "connect") {
      await this.ensureConnected();
      const configured = Boolean(this.config());
      const connected = this.state === "connected" && Boolean(this.ws && this.ws.readyState === 1);
      return Response.json({
        service: "rustplus-cloud", state: this.state,
        configured, connected, companion_connected: connected,
        backend_configured: true,
        pairing_required: !configured,
        connected_at: this.connectedAt, error: this.lastError,
        message: connected
          ? "Облачный Rust+ Companion подключён."
          : !configured
            ? "Добавь данные привязки Rust+ в секреты Cloudflare Worker."
            : this.state === "connecting"
              ? "Облачный Companion подключается к серверу Rust+."
              : this.lastError || "Облачный Companion пока не подключён.",
        free_tier_note: "Проверяется устойчивость постоянного соединения в пределах бесплатных лимитов Cloudflare."
      });
    }
    await this.ensureConnected();
    if (!this.ws || this.ws.readyState !== 1) return Response.json({ error: "rustplus_not_connected", state: this.state, message: this.lastError || "Rust+ is not connected." }, { status: 503 });
    const field = ({ info: 8, team: 11, map: 10, markers: 18 })[path];
    if (!field) return Response.json({ error: "not_found" }, { status: 404 });
    try {
      const result = await this.sendRequest(field);
      if (result.type === "error") return Response.json({ error: result.error }, { status: 502 });
      const data = ({ info: this.lastInfo, team: this.lastTeam, map: this.lastMap, markers: this.lastMarkers })[path];
      return Response.json(data || result);
    } catch (e) {
      return Response.json({ error: "rustplus_request_failed", message: String(e?.message || e) }, { status: 502 });
    }
  }
}
