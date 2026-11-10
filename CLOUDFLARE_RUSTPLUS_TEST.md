# Cloudflare Rust+ (free-tier test)

This prototype moves the Rust+ connection into a Cloudflare Durable Object. It does not use the user's computer, Home Assistant, Discord, or a separate Node host.

## Important limits

- This is a test implementation; it has not yet been deployed or verified against a live Rust server.
- Cloudflare Workers Free currently includes 13,000 GB-seconds/day for Durable Objects and 100,000 Durable Object requests/day.
- An always-open outbound WebSocket is not hibernatable. Cloudflare documents a 15-minute outbound-connection eviction protection window; this implementation sends a small Rust+ info request every 4 minutes to keep the object active. Actual uptime and usage must be measured in the dashboard.
- A 128 MB Durable Object running continuously would use roughly 10,800 GB-seconds/day before other activity, so the free-tier headroom is limited. The service may stop responding if the free quota is exceeded. Do not assume 24/7 reliability until tested.
- Only configure one Rust server for this initial test.

## Required Cloudflare Worker secrets

Set these as secrets in the Cloudflare Worker settings. Never paste pairing values into GitHub or public chat.

- `RUSTPLUS_SERVER_IP`: server IP/hostname from the Rust+ pairing details
- `RUSTPLUS_APP_PORT`: Rust+ app port (not the normal game/query port)
- `RUSTPLUS_PLAYER_ID`: your 17-digit SteamID64 used for pairing
- `RUSTPLUS_PLAYER_TOKEN`: numeric player token from that server's Rust+ pairing

## Deployment

The Worker must be deployed with the Durable Object binding and SQLite migration declared in `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "RUSTPLUS_CLOUD"
class_name = "RustPlusCloud"

[[migrations]]
tag = "rustplus-cloud-v1"
new_sqlite_classes = ["RustPlusCloud"]
```

If the Worker is edited only in the browser dashboard, make sure the Durable Object class and migration are also created/applied in Cloudflare. Merely pasting `worker.js` is not enough.

After deployment, open:

- `/api/rustplus/status`
- `/api/rustplus/info`
- `/api/rustplus/team`
- `/api/rustplus/map`
- `/api/rustplus/markers`

The status endpoint starts the cloud connection. A successful WebSocket handshake alone is not enough; status must remain `connected` and info must return real server details.

## Current implementation scope

The code implements a minimal Rust+ protobuf client for info, team, map, and map markers. Smart switch/alarm/storage entity actions are not exposed yet. Those should be added only after the cloud connection and response decoding are confirmed against a real paired server.
