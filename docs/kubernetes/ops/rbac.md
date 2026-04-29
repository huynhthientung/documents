---
id: rbac
title: RBAC
tags: [kubernetes, rbac, security]
---

# RBAC

Kubernetes RBAC controls who can do what to which resources.

## Objects

| Object | Scope | Purpose |
|---|---|---|
| `Role` | Namespace | Grants permissions within a namespace |
| `ClusterRole` | Cluster-wide | Grants permissions across all namespaces (or non-namespaced resources) |
| `RoleBinding` | Namespace | Binds a Role or ClusterRole to subjects in a namespace |
| `ClusterRoleBinding` | Cluster-wide | Binds a ClusterRole to subjects cluster-wide |

## Read-only Role

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: production
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
```

## Bind to a service account

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-reader-binding
  namespace: production
subjects:
  - kind: ServiceAccount
    name: ci-runner
    namespace: production
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

## IRSA (IAM Roles for Service Accounts) on EKS

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: s3-reader
  namespace: production
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/S3ReaderRole
```

The pod then automatically gets AWS credentials via the OIDC token projection.

## Audit RBAC

```bash
# Who can do what in a namespace?
kubectl auth can-i --list -n production

# Can the ci-runner SA delete deployments?
kubectl auth can-i delete deployments \
  --as=system:serviceaccount:production:ci-runner \
  -n production

# Show all bindings for a subject
kubectl get rolebindings,clusterrolebindings -A \
  -o json | jq '
    .items[] |
    select(.subjects[]?.name == "ci-runner") |
    {name: .metadata.name, role: .roleRef.name}'
```

:::tip Principle of least privilege
Grant the minimum verbs on the minimum resources needed. Never use `*` verbs or resources in production RBAC rules.
:::
