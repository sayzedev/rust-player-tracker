# Rust Player Tracker — Rust+ Companion backend

This is a separate Node.js service. GitHub Pages cannot keep a Rust+ connection alive.

## Required environment variables

- `API_SECRET` — private random secret used by the website/backend API.
- `RUSTPLUS_SERVER_IP` — server IP from the Rust+ pairing notification.
- `RUSTPLUS_APP_PORT` — Rust+ app port from the pairing notification (not the normal game port).
- `RUSTPLUS_PLAYER_ID` — Steam64 ID from pairing.
- `RUSTPLUS_PLAYER_TOKEN` — per-server player token from pairing. Keep private.
- `ALLOWED_ORIGIN` — defaults to this project's GitHub Pages origin.

The `rustplus_auth_token` / GCM values used for Companion push registration are not the same as the per-server `playerToken` required by the direct Rust+ WebSocket client. Do not put either credential set in frontend code or GitHub Pages.

## Pairing prerequisite

The backend needs the server pairing payload containing IP, app port, player ID, and player token. The credential command alone does not contain the per-server pairing payload. Pair the account with the target server using the official Rust+ flow and obtain the pairing notification through a supported Rust+ pairing listener. Never publish the payload or commit it to this repository.

## API

All `/api/*` routes require `Authorization: Bearer <API_SECRET>`.

- `GET /health` — public service health, no secrets.
- `GET /api/rustplus/status`
- `GET /api/rustplus/map`
- `GET /api/rustplus/markers`
- `GET /api/rustplus/team`
- `GET /api/rustplus/info`

The map endpoints only work after valid per-server pairing data is configured and the Rust+ connection is established.

## Deploy

The included Render Blueprint describes the service. Set the four per-server pairing values as private environment variables in the hosting dashboard. Do not paste them into chat or commit them to Git.
