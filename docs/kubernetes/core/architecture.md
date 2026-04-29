---
id: architecture
title: Cluster Architecture
tags: [kubernetes, architecture, control-plane]
---

# Cluster Architecture

## Control Plane components

| Component | Role |
|---|---|
| `kube-apiserver` | All cluster API requests go through here |
| `etcd` | Distributed key-value store — the source of truth |
| `kube-scheduler` | Assigns pods to nodes based on resources and constraints |
| `kube-controller-manager` | Runs reconciliation loops (Node, Deployment, Endpoint controllers) |
| `cloud-controller-manager` | Cloud-specific integrations (LB provisioning, node lifecycle) |

## Node components

| Component | Role |
|---|---|
| `kubelet` | Runs on every node; manages pod lifecycle |
| `kube-proxy` | Maintains iptables/IPVS rules for Service routing |
| Container runtime | Pulls images and runs containers (containerd, CRI-O) |

## High availability

A production control plane runs at least **3 etcd members** and **2 API server replicas** behind a load balancer.

```
┌──────────────────────────────────┐
│          Load Balancer           │
└──────────┬───────────────────────┘
           │
    ┌──────┴──────┐
    │  API Server │  (×2 or ×3)
    └──────┬──────┘
           │
    ┌──────┴──────┐
    │    etcd     │  (×3 members, quorum requires ⌊n/2⌋+1)
    └─────────────┘
```

## etcd backup

```bash
ETCDCTL_API=3 etcdctl snapshot save /backup/etcd-$(date +%F).db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

:::warning
Automate etcd snapshots. Losing etcd = losing cluster state.
:::
