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

function connectRustPlus() {
  const host = process.env.RUSTPLUS_SERVER_IP;
  const port = process.env.RUSTPLUS_APP_PORT;
  const playerId = process.env.RUSTPLUS_PLAYER_ID;
  const playerToken = process.env.RUSTPLUS_PLAYER_TOKEN;

  if (![host, port, playerId, playerToken].every(Boolean)) {
    connectionState = "pairing_data_missing";
    return;
  }

  rustplus = new RustPlus(host, port, playerId, playerToken);
  rustplus.on("connecting", () => { connectionState = "connecting"; });
  rustplus.on("connected", () => {
    connectionState = "connected";
    connectedAt = new Date().toISOString();
    lastError = null;
  });
  rustplus.on("disconnected", () => { connectionState = "disconnected"; });
  rustplus.on("error", (error) => {
    connectionState = "error";
    lastError = String(error?.message || "Rust+ connection error").slice(0, 240);
  });
  rustplus.connect();
}

function rustRequest(method) {
  return (req, res) => {
    if (!rustplus || connectionState !== "connected") {
      return res.status(503).json({ error: "rustplus_not_connected", state: connectionState });
    }
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      res.status(504).json({ error: "rustplus_timeout" });
    }, 12000);

    try {
      rustplus[method]((message) => {
        if (finished) return true;
        finished = true;
        clearTimeout(timeout);
        if (method === "getMap") {
          const map = message?.response?.map || message?.map || null;
          const rawImage = map?.jpgImage;
          if (map && rawImage) {
            let imageBuffer;
            if (Buffer.isBuffer(rawImage)) imageBuffer = rawImage;
            else if (Array.isArray(rawImage)) imageBuffer = Buffer.from(rawImage);
            else if (rawImage?.type === "Buffer" && Array.isArray(rawImage.data)) imageBuffer = Buffer.from(rawImage.data);
            else imageBuffer = Buffer.from(rawImage);
            res.json({
              width: map.width || null,
              height: map.height || null,
              image_data_url: "data:image/jpeg;base64," + imageBuffer.toString("base64"),
              monuments: map.monuments || []
            });
            return true;
          }
        }
        res.json(message);
        return true;
      });
    } catch (error) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      res.status(502).json({ error: "rustplus_request_failed" });
    }
  };
}

app.get("/health", (req, res) => {
  res.json({
    service: "rust-player-tracker-companion",
    state: connectionState,
    configured: connectionState !== "not_configured" && connectionState !== "pairing_data_missing",
    connected_at: connectedAt,
    error: lastError
  });
});

app.get("/api/rustplus/status", requireApiSecret, (req, res) => {
  res.json({ state: connectionState, connected_at: connectedAt, error: lastError });
});

app.get("/api/rustplus/map", requireApiSecret, rustRequest("getMap"));
app.get("/api/rustplus/markers", requireApiSecret, rustRequest("getMapMarkers"));
app.get("/api/rustplus/team", requireApiSecret, rustRequest("getTeamInfo"));
app.get("/api/rustplus/info", requireApiSecret, rustRequest("getInfo"));

app.listen(PORT, () => {
  connectRustPlus();
  console.log(`Rust+ backend listening on port ${PORT}`);
});
