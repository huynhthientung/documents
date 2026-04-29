---
id: waf
title: WAF & Firewall Rules
tags: [cloudflare, waf, security, firewall]
---

# WAF & Firewall Rules

## Managed rules

Enable the Cloudflare Managed Ruleset and OWASP core ruleset under Security → WAF → Managed Rules.

Recommended sensitivity: **Medium** to start. Log only first, then switch to Block.

## Custom rules

Block bad actors with custom expressions:

```
# Block known bad bots
(cf.client.bot) and not (cf.verified_bot_category in {"Search Engine Crawlers" "Monitoring & Analytics"})

# Block requests without a User-Agent
(not http.request.headers["user-agent"][0] exists)

# Country block (adjust to your needs)
(ip.geoip.country in {"CN" "RU" "KP"} and not ip.src in {1.2.3.4})
```

## Rate limiting

```yaml
# Via Terraform
resource "cloudflare_ruleset" "rate_limit" {
  zone_id = var.zone_id
  name    = "Rate Limiting"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules {
    action = "block"
    ratelimit {
      characteristics  = ["ip.src"]
      period           = 60
      requests_per_period = 100
      mitigation_timeout = 600
    }
    expression  = "(http.request.uri.path matches \"^/api/\")"
    description = "Block API abuse"
    enabled     = true
  }
}
```

## Bot Fight Mode

Enable under Security → Bots → Bot Fight Mode. This adds JS challenges for suspicious automated traffic.

For APIs, use **Super Bot Fight Mode** (Pro+) and configure endpoints that should be API-only to require mTLS or tokens instead.

## Security events

Monitor Security → Events to see blocked requests. Export to a SIEM via Logpush:

```bash
# Enable logpush to S3
cloudflare logpush create \
  --zone-id <ZONE-ID> \
  --destination-conf "s3://my-bucket/cf-logs?region=ap-southeast-1" \
  --dataset http_requests \
  --fields "ClientIP,ClientRequestHost,ClientRequestMethod,EdgeResponseStatus,WAFAction"
```
