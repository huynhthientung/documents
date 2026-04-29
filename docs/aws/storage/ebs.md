---
id: ebs
title: EBS
tags: [aws, ebs, storage, csi]
---

# EBS

## EBS CSI Driver

The EBS CSI driver is required to use EBS volumes with EKS. Install it as a managed addon:

```hcl
cluster_addons = {
  aws-ebs-csi-driver = {
    most_recent              = true
    service_account_role_arn = module.ebs_csi_irsa.iam_role_arn
  }
}
```

### IRSA for the CSI driver

```hcl
module "ebs_csi_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name             = "ebs-csi-driver-my-cluster"
  attach_ebs_csi_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:ebs-csi-controller-sa"]
    }
  }
}
```

## Volume types

| Type | IOPS | Throughput | Use case |
|---|---|---|---|
| `gp3` | Up to 16,000 | Up to 1,000 MB/s | General purpose — default choice |
| `io2` | Up to 64,000 | Up to 1,000 MB/s | High-performance databases |
| `st1` | Throughput-optimized | Up to 500 MB/s | Sequential big data |
| `sc1` | Cold HDD | — | Archive / infrequent access |

## StorageClass (gp3)

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

## Volume snapshots

```yaml
# Create a VolumeSnapshotClass
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: ebs-vsc
driver: ebs.csi.aws.com
deletionPolicy: Delete
---
# Snapshot a PVC
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: postgres-snapshot-2024
spec:
  volumeSnapshotClassName: ebs-vsc
  source:
    persistentVolumeClaimName: postgres-data
```

## Restore from snapshot

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data-restore
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: gp3
  resources:
    requests:
      storage: 50Gi
  dataSource:
    name: postgres-snapshot-2024
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
```
