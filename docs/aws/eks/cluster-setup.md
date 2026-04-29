---
id: cluster-setup
title: EKS Cluster Setup
tags: [aws, eks, cluster]
---

# EKS Cluster Setup

## eksctl (quickstart)

```bash
eksctl create cluster \
  --name my-cluster \
  --region ap-southeast-1 \
  --version 1.30 \
  --nodegroup-name workers \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 2 \
  --nodes-max 10 \
  --managed \
  --with-oidc \
  --ssh-access=false
```

## Terraform (production)

```hcl title="eks.tf"
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "my-cluster"
  cluster_version = "1.30"

  vpc_id                         = module.vpc.vpc_id
  subnet_ids                     = module.vpc.private_subnets
  cluster_endpoint_public_access = true

  # OIDC for IRSA
  enable_irsa = true

  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
    aws-ebs-csi-driver = {
      most_recent              = true
      service_account_role_arn = module.ebs_csi_irsa.iam_role_arn
    }
  }

  eks_managed_node_groups = {
    workers = {
      instance_types = ["t3.medium", "t3a.medium"]
      capacity_type  = "ON_DEMAND"
      min_size       = 2
      max_size       = 10
      desired_size   = 2

      labels = {
        role = "worker"
      }
    }
  }

  tags = {
    Environment = "production"
    Terraform   = "true"
  }
}
```

## Post-creation

```bash
# Update kubeconfig
aws eks update-kubeconfig --region ap-southeast-1 --name my-cluster

# Verify cluster
kubectl get nodes -o wide
kubectl get pods -A

# Check cluster version
kubectl version --short
```

## CoreDNS scaling

For clusters above 30 nodes, scale CoreDNS:

```bash
kubectl scale deployment coredns -n kube-system --replicas=3
```
