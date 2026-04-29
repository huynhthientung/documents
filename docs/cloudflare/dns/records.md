---
id: records
title: DNS Records
tags: [cloudflare, dns]
---

# DNS Records

## Common record types

| Type | Use case | Example |
|---|---|---|
| `A` | IPv4 address | `api` → `1.2.3.4` |
| `AAAA` | IPv6 address | `api` → `2606::1` |
| `CNAME` | Alias to another hostname | `docs` → `tunght.github.io` |
| `MX` | Mail exchange | `@` → `mail.example.com` |
| `TXT` | Verification, SPF, DKIM | `@` → `v=spf1 include:...` |

## GitHub Pages setup

```
Type   Name   Content                    Proxy
CNAME  docs   tunght.github.io           DNS only (grey cloud)
```

:::info Custom domain on GitHub Pages
GitHub Pages requires the DNS record to be **unproxied (grey cloud)** when using a CNAME. Proxying breaks the SSL certificate validation flow.

After pointing DNS, go to your repository → Settings → Pages → Custom domain and enter `docs.huynhthientung.com`.
:::

## SPF / DKIM / DMARC

```
TXT  @    v=spf1 include:_spf.google.com ~all
TXT  docs v=DMARC1; p=quarantine; rua=mailto:dmarc@huynhthientung.com
```

## Terraform (via Cloudflare provider)

```hcl
resource "cloudflare_record" "docs_cname" {
  zone_id = var.cloudflare_zone_id
  name    = "docs"
  type    = "CNAME"
  value   = "tunght.github.io"
  proxied = false
  ttl     = 1  # auto when proxied=false
}
```
