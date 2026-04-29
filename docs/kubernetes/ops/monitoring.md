---
id: monitoring
title: Monitoring
tags: [kubernetes, monitoring, prometheus, grafana]
---

# Monitoring

## kube-prometheus-stack

The standard monitoring stack: **Prometheus** (metrics), **Grafana** (dashboards), **Alertmanager** (alerts).

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  -f monitoring-values.yaml
```

### Key `monitoring-values.yaml` settings

```yaml
prometheus:
  prometheusSpec:
    retention: 15d
    storageSpec:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          accessModes: [ReadWriteOnce]
          resources:
            requests:
              storage: 50Gi
    # Scrape all ServiceMonitors cluster-wide
    serviceMonitorSelectorNilUsesHelmValues: false
    podMonitorSelectorNilUsesHelmValues: false

grafana:
  adminPassword: <from-secret>
  ingress:
    enabled: true
    ingressClassName: nginx
    hosts:
      - grafana.internal.example.com
  persistence:
    enabled: true
    storageClassName: gp3
    size: 5Gi

alertmanager:
  alertmanagerSpec:
    storage:
      volumeClaimTemplate:
        spec:
          storageClassName: gp3
          resources:
            requests:
              storage: 2Gi
```

## Useful queries

```promql
# Pod restart rate over 5m
rate(kube_pod_container_status_restarts_total[5m]) > 0

# CPU throttling percentage per container
rate(container_cpu_cfs_throttled_seconds_total[5m])
  / rate(container_cpu_cfs_periods_total[5m]) * 100 > 25

# Memory usage vs request
container_memory_working_set_bytes
  / on(pod, container) kube_pod_container_resource_requests{resource="memory"}

# Node disk pressure
kube_node_status_condition{condition="DiskPressure", status="true"} == 1
```

## ServiceMonitor

Expose custom application metrics:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-server
  namespace: production
  labels:
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      app: api-server
  endpoints:
    - port: metrics
      path: /metrics
      interval: 30s
```
