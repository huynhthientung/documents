---
id: proxying
title: Proxying & SSL Modes
tags: [cloudflare, proxy, ssl, tls]
---

# Proxying & SSL Modes

## Orange cloud vs grey cloud

| Mode | DNS resolves to | Traffic through Cloudflare |
|---|---|---|
| Proxied (🟠) | Cloudflare IPs | Yes — WAF, caching, DDoS apply |
| DNS only (⬜) | Your origin IP | No — direct connection |

Use DNS only for: GitHub Pages CNAMEs, mail records, IPs that need direct access.

## SSL/TLS encryption modes

| Mode | Browser → CF | CF → Origin | Use when |
|---|---|---|---|
| Off | HTTP | HTTP | Never |
| Flexible | HTTPS | HTTP | Origin has no cert (avoid) |
| Full | HTTPS | HTTPS (any cert) | Self-signed origin cert |
| Full (strict) | HTTPS | HTTPS (valid cert) | Origin has a trusted cert |

**Always use Full (strict)** for production. With `cloudflared` tunnels the tunnel terminates at Cloudflare's edge — always Full (strict).

## Always Use HTTPS

Enable in: Zone → SSL/TLS → Edge Certificates → Always Use HTTPS.

Or via a Page Rule / Transform Rule that redirects `http://*` to `https://*`.

## HSTS

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

Enable via: SSL/TLS → Edge Certificates → HTTP Strict Transport Security.

:::warning HSTS preload
Once submitted to the browser preload list, you cannot remove HSTS without breaking non-HTTPS users for months. Only enable preload when you're committed to HTTPS-only forever.
:::

## Minimum TLS version

Set to **TLS 1.2** minimum (TLS 1.0 and 1.1 are deprecated). Found in: SSL/TLS → Edge Certificates → Minimum TLS Version.
