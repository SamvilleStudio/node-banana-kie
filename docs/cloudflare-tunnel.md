# Cloudflare Tunnel Runtime Setup

This document covers two supported ways to expose Node Banana over HTTPS with Cloudflare Tunnel.

## Prerequisites

1. App running locally at `http://localhost:3000`.
2. Docker running (for PostgreSQL and optional tunnel sidecar).
3. A Cloudflare account with a domain in Cloudflare DNS.

## Option A: Local `cloudflared` Install

Use this when Node Banana runs directly on your host machine.

1. Install `cloudflared`:
   - https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Authenticate and create tunnel:
   - `cloudflared tunnel login`
   - `cloudflared tunnel create node-banana`
3. Route DNS:
   - `cloudflared tunnel route dns node-banana your-subdomain.yourdomain.com`
4. Create `~/.cloudflared/config.yml`:

```yaml
tunnel: node-banana
credentials-file: /path/to/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: your-subdomain.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

5. Run tunnel:
   - `cloudflared tunnel run node-banana`

## Option B: Docker Sidecar (`cloudflared`)

Use this when you want tunnel lifecycle managed by Docker Compose.

1. Create tunnel in Cloudflare Zero Trust and copy the connector token.
2. Set token in `.env.local` (or shell env):
   - `CLOUDFLARE_TUNNEL_TOKEN=...`
3. Start sidecar:
   - `npm run tunnel:up`
4. View logs:
   - `npm run tunnel:logs`
5. Stop sidecar:
   - `npm run tunnel:down`

Notes:
- The sidecar service is optional and only starts when profile `tunnel` is used.
- `host.docker.internal` mapping is included for Linux compatibility.
- Configure your Cloudflare tunnel ingress target to `http://host.docker.internal:3000` when app runs on host.

## Verification

1. Ensure app and DB are up:
   - `npm run db:up`
   - `npm run dev`
2. Open your Cloudflare hostname in browser and verify HTTPS access.
3. Confirm workflow save/load and generation actions still work through the tunnel.
