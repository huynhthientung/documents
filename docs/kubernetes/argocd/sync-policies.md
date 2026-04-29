---
id: sync-policies
title: Sync Policies
tags: [argocd, sync, automation]
---

# Sync Policies

## Manual vs automated

By default, ArgoCD detects drift but does **not** apply changes automatically. Enable automated sync only where you trust the Git state completely.

```yaml
syncPolicy:
  automated:
    prune: true       # delete resources removed from Git
    selfHeal: true    # re-apply if cluster state drifts
```

:::warning prune: true
With pruning enabled, removing a file from Git will delete the corresponding Kubernetes resource. Double-check before enabling in production.
:::

## Sync options

```yaml
syncPolicy:
  syncOptions:
    - CreateNamespace=true          # create destination namespace if missing
    - PrunePropagationPolicy=foreground  # wait for cascading delete
    - PruneLast=true                # delete after creating new resources
    - Replace=true                  # use kubectl replace instead of apply
    - ServerSideApply=true          # use SSA (handles large CRDs)
    - RespectIgnoreDifferences=true # apply ignoreFields during sync
```

## Ignore differences

Ignore fields managed by external controllers to prevent constant drift detection:

```yaml
spec:
  ignoreDifferences:
    - group: apps
      kind: Deployment
      jsonPointers:
        - /spec/replicas          # managed by HPA
    - group: ""
      kind: Service
      jsonPointers:
        - /spec/clusterIP         # assigned by Kubernetes
    - group: autoscaling
      kind: HorizontalPodAutoscaler
      jqPathExpressions:
        - .spec.metrics[] | select(.type == "ContainerResource")
```

## Manual sync triggers

```bash
# Sync with pruning
argocd app sync my-app --prune

# Sync a specific resource only
argocd app sync my-app --resource apps:Deployment:api-server

# Dry run
argocd app sync my-app --dry-run

# Force replace (use with caution)
argocd app sync my-app --replace
```

## Refresh

Refresh fetches the latest Git state without applying:

```bash
argocd app get my-app --refresh
```

Force hard refresh (busts the manifest cache):

```bash
argocd app get my-app --hard-refresh
```
