---
id: intro
title: Cloudflare Overview
sidebar_label: Overview
slug: /cloudflare/intro
tags: [cloudflare, overview]
---

# Cloudflare

Reference documentation for using Cloudflare as a DNS provider, reverse proxy, Zero Trust gateway, and WAF.

## What's covered

| Section | Topics |
|---|---|
| [DNS Records](/cloudflare/dns/records) | A, CNAME, MX, TXT records |
| [Proxying](/cloudflare/dns/proxying) | Orange-cloud vs grey-cloud, SSL modes |
| [Tunnels Setup](/cloudflare/tunnels/setup) | `cloudflared`, tunnel creation |
| [K8s Integration](/cloudflare/tunnels/k8s-integration) | Running cloudflared in Kubernetes |
| [WAF](/cloudflare/security/waf) | Managed rules, custom rules, rate limiting |
| [Zero Trust](/cloudflare/security/zero-trust) | Access policies, identity providers |

## Why Cloudflare?

- **DDoS protection** — absorbs volumetric attacks at the edge
- **Global CDN** — static assets cached at 300+ PoPs
- **Zero Trust** — replace VPN with identity-aware access
- **Free tier** — generous limits for DNS + proxy

## Account structure

```
Account
└── Zone (domain: huynhthientung.com)
    ├── DNS records
    ├── Firewall rules
    ├── Tunnels
    └── Access policies
```
