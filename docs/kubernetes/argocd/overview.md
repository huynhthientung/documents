---
id: overview
title: ArgoCD Overview
tags: [argocd, gitops, kubernetes]
---

# ArgoCD

ArgoCD is a declarative, GitOps continuous delivery tool for Kubernetes. The cluster state is always derived from Git — ArgoCD watches your repo and reconciles divergence automatically.

## Core model

```
Git Repo (desired state)
       │
       ▼
  ArgoCD controller
       │  diffs current vs desired
       ▼
  Kubernetes API  (live state)
```

## Key concepts

| Concept | Description |
|---|---|
| **Application** | Maps a Git source to a K8s destination |
| **Project** | Groups applications, enforces RBAC/source restrictions |
| **Sync** | Applies manifests from Git to the cluster |
| **Health** | Status of K8s resources (Healthy, Degraded, Progressing) |
| **Refresh** | Re-fetches Git state without applying |

## Quick access

```bash
# Port-forward ArgoCD UI
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Login with CLI
argocd login localhost:8080 --username admin --password $(
  kubectl get secret argocd-initial-admin-secret \
    -n argocd -o jsonpath="{.data.password}" | base64 -d
)

# List apps
argocd app list

# Sync an app
argocd app sync my-app

# Watch sync status
argocd app wait my-app --sync --health
```

## Why GitOps?

- **Audit trail**: every change is a Git commit
- **Rollback**: `git revert` is a valid deployment strategy
- **Drift detection**: ArgoCD alerts when live state diverges from Git
- **Multi-cluster**: one ArgoCD instance can manage many clusters
