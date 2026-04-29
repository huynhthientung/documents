---
id: zero-trust
title: Zero Trust Access
tags: [cloudflare, zero-trust, access, sso]
---

# Zero Trust Access

Cloudflare Access acts as an identity-aware reverse proxy. Users must authenticate before reaching your origin.

## Access Application

```yaml
# Terraform
resource "cloudflare_access_application" "grafana" {
  zone_id          = var.zone_id
  name             = "Grafana"
  domain           = "grafana.huynhthientung.com"
  type             = "self_hosted"
  session_duration = "12h"

  # Bypass the login page for Prometheus scrape endpoints
  cors_headers {
    allowed_methods = ["GET"]
    allow_all_origins = false
    allowed_origins = ["https://prometheus.huynhthientung.com"]
  }
}
```

## Identity provider (GitHub)

```yaml
resource "cloudflare_access_identity_provider" "github" {
  account_id = var.account_id
  name       = "GitHub"
  type       = "github"

  config {
    client_id     = var.github_client_id
    client_secret = var.github_client_secret
  }
}
```

## Access Policy

```yaml
resource "cloudflare_access_policy" "grafana_admins" {
  application_id = cloudflare_access_application.grafana.id
  zone_id        = var.zone_id
  name           = "Allow team members"
  precedence     = 1
  decision       = "allow"

  include {
    github {
      name                 = "my-org"
      identity_provider_id = cloudflare_access_identity_provider.github.id
    }
  }
}
```

## Service tokens (machine-to-machine)

For automated access (CI pipelines, health checks):

```bash
# Create via dashboard: Access → Service Auth → Create Service Token
# Returns: Client ID + Client Secret

# Use in request headers
curl https://internal-service.huynhthientung.com \
  -H "CF-Access-Client-Id: <client-id>.access" \
  -H "CF-Access-Client-Secret: <client-secret>"
```

## Cloudflare WARP (device enrollment)

For private network access without exposing ports:

1. Deploy a Cloudflare Tunnel to your private network
2. Configure split tunneling in WARP client
3. Users install WARP and authenticate via your identity provider
4. Traffic to private IP ranges routes through the tunnel

```
User Laptop (WARP) → Cloudflare Edge → Tunnel → Private K8s Services
```
