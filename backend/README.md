# Rust Player Tracker — Rust+ Companion

This Node.js service keeps the Rust+ WebSocket connection alive. GitHub Pages and a Cloudflare Worker cannot keep that server-side connection alive by themselves.

## Windows local setup

1. Install Node.js LTS: https://nodejs.org/
2. Download this repository from GitHub and extract it.
3. Open the `backend` folder and run `start-local.bat`.
4. On first run, the script creates `.env` from `.env.example`. Fill it in locally, save it, then run `start-local.bat` again.
5. Keep this window open while using Rust+.

Never send the contents of `.env` in chat, screenshots, or GitHub. The repository ignores this file.

## Environment variables

- `API_SECRET` — long random secret shared only between this backend and the Cloudflare Worker.
- `RUSTPLUS_SERVER_IP` — server address from your own Rust+ pairing details.
- `RUSTPLUS_APP_PORT` — Rust+ app port from the pairing details, not the normal game port.
- `RUSTPLUS_PLAYER_ID` — your 17-digit SteamID64 from the pairing details.
- `RUSTPLUS_PLAYER_TOKEN` — per-server player token from the pairing details.
- `ALLOWED_ORIGIN` — defaults to `https://sayzedev.github.io`.

Pair through the official Rust+ flow for a server you are allowed to access. The pairing details are private credentials; keep them on your own device. Do not put them in frontend code or GitHub.

## Make the local API reachable by the Worker

The Worker runs on Cloudflare, so it cannot call `localhost` on your PC. For a temporary test, install `cloudflared` and run a Quick Tunnel in a second terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

Cloudflare prints a temporary `https://....trycloudflare.com` address. Put that address into the Cloudflare Worker secret `RUSTPLUS_BACKEND_URL`. Put the same random value used as local `API_SECRET` into the Worker secret `RUSTPLUS_BACKEND_SECRET`. Keep the URL and secret private. The quick URL changes when the tunnel is restarted, and both the PC service and tunnel must remain running.

Quick Tunnels are for testing, not permanent hosting. See the [official Cloudflare Quick Tunnel guide](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## API

All `/api/*` routes require `Authorization: Bearer <API_SECRET>`.

- `GET /health` — public health status, no secrets.
- `GET /api/rustplus/status`
- `GET /api/rustplus/map`
- `GET /api/rustplus/markers`
- `GET /api/rustplus/team`
- `GET /api/rustplus/info`

The map, team, markers, and server information endpoints return live data only after the Rust+ WebSocket connection is established.
