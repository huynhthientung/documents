---
id: intro
title: Kubernetes Overview
sidebar_label: Overview
slug: /kubernetes/intro
tags: [kubernetes, overview]
---

# Kubernetes

Reference documentation for running production Kubernetes clusters — covering core concepts, GitOps with ArgoCD, and day-2 operations.

## What's covered

| Section | Topics |
|---|---|
| [Core Concepts](/kubernetes/core/architecture) | Nodes, API server, etcd, scheduling |
| [Workloads](/kubernetes/core/workloads) | Deployments, StatefulSets, DaemonSets, Jobs |
| [Networking](/kubernetes/core/networking) | Services, Ingress, NetworkPolicy, CoreDNS |
| [Storage](/kubernetes/core/storage) | PVCs, StorageClasses, CSI drivers |
| [ArgoCD](/kubernetes/argocd/overview) | GitOps, App of Apps, sync policies |
| [Operations](/kubernetes/ops/monitoring) | Monitoring, scaling, RBAC |

## Quick reference

```bash
# Cluster info
kubectl cluster-info
kubectl get nodes -o wide

# Current context
kubectl config current-context
kubectl config get-contexts

# All resources in a namespace
kubectl get all -n <namespace>

# Describe a failing pod
kubectl describe pod <pod-name> -n <namespace>
kubectl logs <pod-name> -n <namespace> --previous
```

:::tip Namespace conventions
Use dedicated namespaces per team or application tier. Avoid overloading `default`.
:::
