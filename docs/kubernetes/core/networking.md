---
id: networking
title: Networking
tags: [kubernetes, networking, ingress, service]
---

# Networking

## Service types

| Type | Use case |
|---|---|
| `ClusterIP` | Internal-only; default |
| `NodePort` | Exposes on each node's IP — avoid in prod |
| `LoadBalancer` | Provisions a cloud LB; one IP per service |
| `ExternalName` | DNS alias to an external service |

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api-service
spec:
  selector:
    app: api-server
  ports:
    - port: 80
      targetPort: 8080
      protocol: TCP
  type: ClusterIP
```

## Ingress (NGINX)

Prefer a single `LoadBalancer` service for the Ingress controller, then route via Ingress resources — much cheaper than one LB per service.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
      secretName: api-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 80
```

## NetworkPolicy

Default Kubernetes allows all pod-to-pod traffic. Lock it down with NetworkPolicy.

```yaml
# Deny all ingress by default, then explicitly allow
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: production
spec:
  podSelector: {}
  policyTypes:
    - Ingress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-api-from-frontend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: api-server
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - port: 8080
```

:::note CNI requirement
NetworkPolicy requires a CNI that enforces it: **Calico**, **Cilium**, or **Weave**. Flannel does not enforce policies.
:::

## CoreDNS

Service discovery uses `<service>.<namespace>.svc.cluster.local`. Pods in the same namespace can omit the FQDN.

```bash
# From any pod
nslookup api-service.production.svc.cluster.local
```
