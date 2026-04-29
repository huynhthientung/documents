---
id: node-groups
title: Node Groups
tags: [aws, eks, nodes, spot]
---

# Node Groups

## On-demand vs Spot

| Type | Cost | Interruption | Use for |
|---|---|---|---|
| On-demand | Full price | None | Control plane add-ons, stateful workloads |
| Spot | Up to 90% off | 2-min notice | Stateless workers, batch jobs |

## Mixed node group (Karpenter)

Karpenter is the recommended node provisioner for EKS. It provisions nodes in seconds and supports diverse instance types.

```yaml title="karpenter-nodepool.yaml"
apiVersion: karpenter.sh/v1
kind: NodePool
metadata:
  name: default
spec:
  template:
    spec:
      requirements:
        - key: karpenter.sh/capacity-type
          operator: In
          values: ["on-demand", "spot"]
        - key: kubernetes.io/arch
          operator: In
          values: ["amd64", "arm64"]
        - key: karpenter.k8s.aws/instance-category
          operator: In
          values: ["c", "m", "r"]
        - key: karpenter.k8s.aws/instance-generation
          operator: Gt
          values: ["2"]
      nodeClassRef:
        apiVersion: karpenter.k8s.aws/v1
        kind: EC2NodeClass
        name: default
  disruption:
    consolidationPolicy: WhenEmptyOrUnderutilized
    consolidateAfter: 1m
  limits:
    cpu: 100
    memory: 400Gi
---
apiVersion: karpenter.k8s.aws/v1
kind: EC2NodeClass
metadata:
  name: default
spec:
  amiSelectorTerms:
    - alias: al2023@latest
  role: KarpenterNodeRole-my-cluster
  subnetSelectorTerms:
    - tags:
        karpenter.sh/discovery: my-cluster
  securityGroupSelectorTerms:
    - tags:
        karpenter.sh/discovery: my-cluster
  tags:
    Environment: production
```

## ARM64 (Graviton)

Graviton3 instances (`c7g`, `m7g`, `r7g`) offer ~30% better price/performance for compute-heavy workloads.

```yaml
# Pin a deployment to Graviton
spec:
  template:
    spec:
      nodeSelector:
        kubernetes.io/arch: arm64
      containers:
        - name: app
          image: ghcr.io/org/app:1.0.0   # must be multi-arch or arm64 image
```

## Managed node group update

```bash
# Trigger a rolling update to the latest AMI
aws eks update-nodegroup-version \
  --cluster-name my-cluster \
  --nodegroup-name workers \
  --region ap-southeast-1
```
