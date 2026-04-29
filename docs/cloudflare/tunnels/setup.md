---
id: setup
title: Cloudflare Tunnel Setup
tags: [cloudflare, tunnel, cloudflared]
---

# Cloudflare Tunnel Setup

Cloudflare Tunnel (`cloudflared`) creates an outbound-only connection from your origin to Cloudflare's edge. No inbound firewall rules needed.

## Create a tunnel

```bash
# Authenticate (opens browser)
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create my-cluster

# List tunnels
cloudflared tunnel list
```

This creates a credential file at `~/.cloudflared/<UUID>.json`.

## Config file

```yaml title="~/.cloudflared/config.yaml"
tunnel: <TUNNEL-UUID>
credentials-file: /home/user/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: api.huynhthientung.com
    service: http://localhost:8080
  - hostname: grafana.huynhthientung.com
    service: http://localhost:3000
  - service: http_status:404    # catch-all
```

## Route DNS

```bash
cloudflared tunnel route dns my-cluster api.huynhthientung.com
```

This creates a CNAME `api.huynhthientung.com → <UUID>.cfargotunnel.com` in your Cloudflare zone, proxied (orange cloud).

## Run the tunnel

```bash
# Foreground
cloudflared tunnel run my-cluster

# As a systemd service
cloudflared service install
systemctl enable --now cloudflared
```

## Verify

```bash
cloudflared tunnel info my-cluster
```

Check the connection count — should show active connections from your origin to Cloudflare PoPs.
