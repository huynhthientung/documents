---
id: iam-roles
title: IAM Roles for Service Accounts (IRSA)
tags: [aws, eks, iam, irsa, oidc]
---

# IAM Roles for Service Accounts (IRSA)

IRSA lets Kubernetes pods assume IAM roles without storing credentials. The mechanism uses OIDC token projection.

## How it works

```
Pod → kubelet injects projected token
           → AWS STS validates token against EKS OIDC endpoint
           → Returns temporary credentials for the IAM role
```

## Setup (Terraform)

```hcl title="irsa.tf"
# Get OIDC issuer URL from the cluster
data "aws_eks_cluster" "cluster" {
  name = "my-cluster"
}

data "aws_iam_openid_connect_provider" "cluster" {
  url = data.aws_eks_cluster.cluster.identity[0].oidc[0].issuer
}

# Create an IAM role for a specific service account
module "s3_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name = "s3-reader-production"

  oidc_providers = {
    main = {
      provider_arn               = data.aws_iam_openid_connect_provider.cluster.arn
      namespace_service_accounts = ["production:s3-reader"]
    }
  }

  role_policy_arns = {
    policy = aws_iam_policy.s3_read.arn
  }
}

resource "aws_iam_policy" "s3_read" {
  name = "s3-read-production"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:ListBucket"]
      Resource = [
        "arn:aws:s3:::my-bucket",
        "arn:aws:s3:::my-bucket/*"
      ]
    }]
  })
}
```

## Service Account annotation

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: s3-reader
  namespace: production
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/s3-reader-production
```

## Pod using the service account

```yaml
spec:
  serviceAccountName: s3-reader
  containers:
    - name: app
      image: ...
      # AWS SDK automatically picks up credentials via the projected token
```

## Verify

```bash
# Inside the pod
aws sts get-caller-identity
# Should return the assumed role ARN, not the node instance profile
```

:::tip Scope tightly
Each service account should have its own IAM role. Never share an IAM role between service accounts in different namespaces.
:::
