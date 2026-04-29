---
id: installation
title: ArgoCD Installation
tags: [argocd, installation, helm]
---

# Installing ArgoCD

## Helm (recommended)

```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

helm install argocd argo/argo-cd \
  --namespace argocd \
  --create-namespace \
  --version 7.x \
  -f argocd-values.yaml
```

### Minimal `argocd-values.yaml`

```yaml
global:
  domain: argocd.internal.example.com

server:
  ingress:
    enabled: true
    ingressClassName: nginx
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    tls: true

configs:
  params:
    server.insecure: false    # TLS terminated at ingress; still use HTTPS internally

  cm:
    # Disable anonymous access
    users.anonymous.enabled: "false"
    # Allow out-of-sync apps to still be visible in the UI
    resource.customizations.health.argoproj.io_Application: |
      hs = {}
      hs.status = "Progressing"
      hs.message = ""
      if obj.status ~= nil then
        if obj.status.health ~= nil then
          hs.status = obj.status.health.status
          if obj.status.health.message ~= nil then
            hs.message = obj.status.health.message
          end
        end
      end
      return hs

  rbac:
    policy.default: role:readonly
    policy.csv: |
      p, role:org-admin, applications, *, */*, allow
      p, role:org-admin, clusters, get, *, allow
      p, role:org-admin, repositories, *, *, allow
      g, argocd-admins, role:org-admin

repoServer:
  resources:
    requests:
      cpu: 100m
      memory: 256Mi

applicationSet:
  enabled: true
```

## Initial admin password

```bash
kubectl get secret argocd-initial-admin-secret \
  -n argocd \
  -o jsonpath="{.data.password}" | base64 -d && echo
```

Change it immediately after first login, then delete the secret:

```bash
argocd account update-password
kubectl delete secret argocd-initial-admin-secret -n argocd
```

## Verify

```bash
kubectl get pods -n argocd
kubectl get svc -n argocd
```

All pods should be `Running`. The `argocd-server` service type can be `ClusterIP` if you route via Ingress.
