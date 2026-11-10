const express = require("express");
const RustPlus = require("@liamcottle/rustplus.js");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const PORT = Number(process.env.PORT || 3000);
const API_SECRET = process.env.API_SECRET || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://sayzedev.github.io";

let rustplus = null;
let connectionState = "not_configured";
let lastError = null;
let connectedAt = null;
let reconnectTimer = null;
let reconnectDelay = 3000;
let shuttingDown = false;

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function requireApiSecret(req, res, next) {
  if (!API_SECRET) return res.status(503).json({ error: "api_secret_not_configured" });
  const auth = req.get("authorization") || "";
  if (auth !== `Bearer ${API_SECRET}`) return res.status(401).json({ error: "unauthorized" });
  next();
}

function getPairingConfig() {
  const host = String(process.env.RUSTPLUS_SERVER_IP || "").trim();
  const portText = String(process.env.RUSTPLUS_APP_PORT || "").trim();
  const playerId = String(process.env.RUSTPLUS_PLAYER_ID || "").trim();
  const playerToken = String(process.env.RUSTPLUS_PLAYER_TOKEN || "").trim();
  const port = Number(portText);
  if (!host || !/^\d{17}$/.test(playerId) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^-?\d+$/.test(playerToken) || !Number.isSafeInteger(Number(playerToken))) {
    return null;
  }
  return { host, port: String(port), playerId, playerToken };
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(Math.round(reconnectDelay * 1.7), 60000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectRustPlus();
  }, delay);
  if (typeof reconnectTimer.unref === "function") reconnectTimer.unref();
}

function connectRustPlus() {
  if (shuttingDown) return;
  const config = getPairingConfig();
  if (!config) {
    connectionState = Object.values(process.env).some(Boolean) ? "pairing_data_missing" : "not_configured";
    return;
  }

  connectionState = "connecting";
  lastError = null;
  try {
    const client = new RustPlus(config.host, config.port, config.playerId, config.playerToken);
    rustplus = client;
    client.on("connecting", () => {
      if (rustplus === client) connectionState = "connecting";
    });
    client.on("connected", () => {
      if (rustplus !== client) return;
      connectionState = "connected";
      connectedAt = new Date().toISOString();
      reconnectDelay = 3000;
      lastError = null;
    });
    client.on("disconnected", () => {
      if (rustplus !== client) return;
      connectionState = "disconnected";
      scheduleReconnect();
    });
    client.on("error", (error) => {
      if (rustplus !== client) return;
      connectionState = "error";
      lastError = String(error?.message || "Rust+ connection error").slice(0, 240);
      scheduleReconnect();
    });
    client.connect();
  } catch (error) {
    rustplus = null;
    connectionState = "error";
    lastError = String(error?.message || "Rust+ connection failed").slice(0, 240);
    scheduleReconnect();
  }
}

function rustRequest(method) {
  return (req, res) => {
    if (!rustplus || connectionState !== "connected") {
      return res.status(503).json({
        error: "rustplus_not_connected",
        state: connectionState,
        message: lastError || "Companion пока не подключён."
      });
    }
    if (typeof rustplus[method] !== "function") {
      return res.status(501).json({ error: "rustplus_method_unavailable", method });
    }

    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      res.status(504).json({ error: "rustplus_timeout", message: "Сервер Rust+ не ответил вовремя." });
    }, 15000);

    try {
      rustplus[method]((message) => {
        if (finished) return true;
        finished = true;
        clearTimeout(timeout);

        if (method === "getMap") {
          const map = message?.response?.map || message?.map || null;
          const rawImage = map?.jpgImage;
          if (map && rawImage) {
            const imageBuffer = Buffer.isBuffer(rawImage)
              ? rawImage
              : Buffer.from(rawImage?.type === "Buffer" && Array.isArray(rawImage.data) ? rawImage.data : rawImage);
            res.json({
              width: map.width || null,
              height: map.height || null,
              image_data_url: "data:image/jpeg;base64," + imageBuffer.toString("base64"),
              monuments: map.monuments || []
            });
            return true;
          }
        }

        if (message?.response?.error) {
          res.status(502).json({ error: "rustplus_server_error", message: String(message.response.error.error || "Ошибка ответа Rust+").slice(0, 200) });
          return true;
        }
        res.json(message);
        return true;
      });
    } catch (error) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      res.status(502).json({ error: "rustplus_request_failed", message: "Не удалось выполнить запрос Rust+." });
    }
  };
}

app.get("/health", (req, res) => {
  res.json({
    service: "rust-player-tracker-companion",
    state: connectionState,
    configured: Boolean(getPairingConfig()),
    connected_at: connectedAt,
    error: lastError
  });
});

app.get("/api/rustplus/status", requireApiSecret, (req, res) => {
  res.json({
    state: connectionState,
    configured: Boolean(getPairingConfig()),
    connected_at: connectedAt,
    error: lastError
  });
});

app.get("/api/rustplus/map", requireApiSecret, rustRequest("getMap"));
app.get("/api/rustplus/markers", requireApiSecret, rustRequest("getMapMarkers"));
app.get("/api/rustplus/team", requireApiSecret, rustRequest("getTeamInfo"));
app.get("/api/rustplus/info", requireApiSecret, rustRequest("getInfo"));

const server = app.listen(PORT, () => {
  console.log(`Rust+ Companion API listening on port ${PORT}`);
  connectRustPlus();
});

function shutdown() {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (rustplus && typeof rustplus.disconnect === "function") {
    try { rustplus.disconnect(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
