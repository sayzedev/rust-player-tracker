# Rust+ Companion on Cloudflare

The website stores the user's Facepunch Rust+ auth token in that user's Cloudflare Durable Object, reads the recent Facepunch notification history to discover the latest server-pairing payload, and connects to Facepunch's Companion WebSocket:

- History: `POST https://companion-rust.facepunch.com/api/history/read`
- Companion socket: `wss://companion-rust.facepunch.com/socket/{serverId}`
- WebSocket subprotocols: `rustplus.auth.v1` and the base64url-encoded Rust+ auth token.

The player ID and player token from the pairing payload authenticate Rust+ requests. The website never asks the user to paste the player token, server IP, or app port into the public page.

## User setup

1. Sign in to the website using Steam.
2. Open the official Facepunch Rust+ login from the Rust+ tab.
3. Complete the Facepunch login, return to the website, and use the browser extension to import the Rust+ auth token.
4. Save the token using the protected save button.
5. Join the Rust server in the game, open the Rust+ menu, and select **Pair with Server**.
6. Return to the website and click **Find game pairing**. The Worker requests Facepunch notification history, extracts the matching server pairing, stores it in the user's Durable Object, and starts the Companion WebSocket.
7. Once status reports the Companion connected, load server info, team, map markers, and the map image.

The Durable Object also checks notification history on its scheduled alarm when a token has been saved but no pairing has been found. Manual sync is available immediately after pairing in game.

## Cloudflare configuration

The existing Worker deployment needs:

- The `RUSTPLUS_CLOUD` Durable Object binding.
- The `rustplus-cloud-v1` SQLite migration (already declared in `wrangler.toml`).
- The existing `STEAM_SESSION_SECRET` Worker secret for website Steam sessions.
- GitHub Actions repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for automatic deployment.

No static `RUSTPLUS_SERVER_IP`, `RUSTPLUS_APP_PORT`, `RUSTPLUS_PLAYER_ID`, or `RUSTPLUS_PLAYER_TOKEN` Worker secrets are needed by the Facepunch Companion flow.

## Important limitations

- The Facepunch notification history endpoint is reverse-engineered and can change. It may contain only a limited recent history. If a pairing is not present, repeat **Pair with Server** in the game and then sync again.
- The Rust+ auth token expires and must be renewed through Facepunch when rejected.
- The Worker and Durable Object syntax and deployment are checked by GitHub Actions, but a successful deployment is not proof of a live Rust server connection. A real in-game pairing and live Companion response are required to verify end-to-end connectivity.
- An always-open outbound WebSocket is not hibernatable. Cloudflare Durable Objects Free quotas are limited; scheduled history checks and a persistent connection consume usage. Monitor Cloudflare usage before relying on continuous uptime. Free-tier capacity is not a promise of 24/7 service.
- Only one active paired server is stored per Steam account in this first version. A future multi-server UI should store and select multiple pairings separately.

## Current supported data

Once the Companion socket is verified connected, the site can request server info, team info, map image, and map markers. Smart-device actions, chat commands, camera controls, and push notifications are not enabled in this version.
