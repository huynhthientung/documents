---
id: scaling
title: Scaling
tags: [kubernetes, hpa, vpa, keda, autoscaling]
---

# Scaling

## Horizontal Pod Autoscaler (HPA)

Scale based on CPU/memory or custom metrics.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: AverageValue
          averageValue: 200Mi
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300   # wait 5m before scaling down
      policies:
        - type: Percent
          value: 20
          periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
```

## KEDA (event-driven autoscaling)

Scale on external signals: queue depth, HTTP request rate, Prometheus metrics.

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaler
  namespace: production
spec:
  scaleTargetRef:
    name: worker-deployment
  minReplicaCount: 0      # scale to zero when idle
  maxReplicaCount: 50
  cooldownPeriod: 120
  triggers:
    - type: rabbitmq
      metadata:
        queueName: tasks
        queueLength: "10"   # one replica per 10 messages
      authenticationRef:
        name: rabbitmq-trigger-auth
```

## Cluster Autoscaler (AWS)

```yaml
# Annotate the node group
eksctl scale nodegroup \
  --cluster my-cluster \
  --name workers \
  --nodes-min 2 \
  --nodes-max 20
```

Key Cluster Autoscaler flags:

| Flag | Value | Notes |
|---|---|---|
| `--scale-down-delay-after-add` | `5m` | Wait after scale-up before evaluating scale-down |
| `--scale-down-unneeded-time` | `10m` | How long a node must be unneeded before removal |
| `--skip-nodes-with-system-pods` | `true` | Protect nodes with kube-system pods |
| `--balance-similar-node-groups` | `true` | Keep AZ balance |

## Vertical Pod Autoscaler (VPA)

Use in `Off` mode to get *recommendations* without auto-applying in production:

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: api-server-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  updatePolicy:
    updateMode: Off    # recommendations only; set to Auto with caution
```

```bash
kubectl get vpa api-server-vpa -o jsonpath='{.status.recommendation}' | jq .
```
