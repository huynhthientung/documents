---
id: storage
title: Storage
tags: [kubernetes, storage, pvc, csi]
---

# Storage

## Concepts

| Resource | Role |
|---|---|
| `PersistentVolume` (PV) | Cluster-level storage resource |
| `PersistentVolumeClaim` (PVC) | Namespaced request for storage |
| `StorageClass` | Template for dynamic provisioning |

## StorageClass (AWS EBS gp3)

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: gp3
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
  encrypted: "true"
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Retain
allowVolumeExpansion: true
```

## PVC

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
  namespace: production
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: gp3
  resources:
    requests:
      storage: 50Gi
```

## Access modes

| Mode | Abbreviation | Support |
|---|---|---|
| ReadWriteOnce | RWO | Most block storage |
| ReadWriteMany | RWX | NFS, EFS, CephFS |
| ReadOnlyMany | ROX | Rare |

## Volume expansion

Most CSI drivers support online expansion — no pod restart needed.

```bash
kubectl patch pvc postgres-data \
  -n production \
  -p '{"spec":{"resources":{"requests":{"storage":"100Gi"}}}}'
```

## Ephemeral storage

For scratch space that doesn't need persistence, use `emptyDir`:

```yaml
volumes:
  - name: cache
    emptyDir:
      sizeLimit: 500Mi
```

:::warning Data loss
`emptyDir` is destroyed when the pod is removed. Never store anything you need to keep.
:::
