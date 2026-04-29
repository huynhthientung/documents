---
id: app-of-apps
title: App of Apps Pattern
tags: [argocd, gitops, app-of-apps]
---

# App of Apps Pattern

The App of Apps pattern uses a single ArgoCD `Application` that manages other `Application` manifests stored in Git. This gives you a single entry point to bootstrap an entire cluster.

## Directory structure

```
gitops/
├── bootstrap/
│   └── app-of-apps.yaml       ← root app (apply this once)
└── apps/
    ├── monitoring.yaml
    ├── ingress-nginx.yaml
    ├── cert-manager.yaml
    └── my-service.yaml
```

## Root Application

```yaml title="bootstrap/app-of-apps.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: app-of-apps
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.io
spec:
  project: default
  source:
    repoURL: https://github.com/org/gitops.git
    targetRevision: HEAD
    path: apps
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

## Child Application example

```yaml title="apps/ingress-nginx.yaml"
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ingress-nginx
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.io
spec:
  project: default
  source:
    repoURL: https://kubernetes.github.io/ingress-nginx
    chart: ingress-nginx
    targetRevision: 4.10.x
    helm:
      valuesObject:
        controller:
          replicaCount: 2
          service:
            type: LoadBalancer
  destination:
    server: https://kubernetes.default.svc
    namespace: ingress-nginx
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

## Bootstrap

```bash
kubectl apply -f bootstrap/app-of-apps.yaml
```

ArgoCD will discover and sync all child applications automatically.

:::info Ordering
If apps have dependencies (e.g., cert-manager must be ready before services that need certificates), use [sync waves](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/):

```yaml
metadata:
  annotations:
    argocd.argoproj.io/sync-wave: "-1"   # negative = earlier wave
```
:::
