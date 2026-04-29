---
id: k8s-integration
title: Tunnel in Kubernetes
tags: [cloudflare, tunnel, kubernetes]
---

# Running cloudflared in Kubernetes

## Secret

Store the tunnel credentials as a Kubernetes Secret:

```bash
kubectl create secret generic cloudflared-credentials \
  --from-file=credentials.json=/path/to/<UUID>.json \
  -n cloudflare-tunnel
```

## ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: cloudflared-config
  namespace: cloudflare-tunnel
data:
  config.yaml: |
    tunnel: <TUNNEL-UUID>
    credentials-file: /etc/cloudflared/credentials.json
    metrics: 0.0.0.0:2000
    no-autoupdate: true

    ingress:
      - hostname: api.huynhthientung.com
        service: http://api-service.production.svc.cluster.local:80
      - hostname: grafana.huynhthientung.com
        service: http://kube-prometheus-stack-grafana.monitoring.svc.cluster.local:80
      - service: http_status:404
```

## Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
  namespace: cloudflare-tunnel
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cloudflared
  template:
    metadata:
      labels:
        app: cloudflared
    spec:
      containers:
        - name: cloudflared
          image: cloudflare/cloudflared:2024.12.0
          args:
            - tunnel
            - --config
            - /etc/cloudflared/config.yaml
            - run
          ports:
            - containerPort: 2000
              name: metrics
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 128Mi
          livenessProbe:
            httpGet:
              path: /ready
              port: 2000
            initialDelaySeconds: 10
            periodSeconds: 10
          volumeMounts:
            - name: config
              mountPath: /etc/cloudflared
            - name: credentials
              mountPath: /etc/cloudflared/credentials.json
              subPath: credentials.json
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: cloudflared-config
        - name: credentials
          secret:
            secretName: cloudflared-credentials
```

## ServiceMonitor (optional)

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: cloudflared
  namespace: cloudflare-tunnel
spec:
  selector:
    matchLabels:
      app: cloudflared
  endpoints:
    - port: metrics
      path: /metrics
```

## Verify

```bash
kubectl logs -n cloudflare-tunnel -l app=cloudflared --tail=20
```

You should see `INF Connection registered` for each cloudflared replica.
