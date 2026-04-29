---
id: intro
title: AWS Overview
sidebar_label: Overview
slug: /aws/intro
tags: [aws, overview]
---

# AWS

Reference documentation for AWS services used in production infrastructure — focusing on EKS, networking, and storage.

## What's covered

| Section | Topics |
|---|---|
| [Cluster Setup](/aws/eks/cluster-setup) | eksctl, Terraform, initial config |
| [Node Groups](/aws/eks/node-groups) | Managed nodes, Spot, ARM64 |
| [IAM Roles](/aws/eks/iam-roles) | IRSA, OIDC, least-privilege patterns |
| [VPC](/aws/networking/vpc) | Subnets, NAT gateway, VPC design |
| [Load Balancers](/aws/networking/load-balancers) | ALB, NLB, AWS Load Balancer Controller |
| [S3](/aws/storage/s3) | Buckets, policies, lifecycle rules |
| [EBS](/aws/storage/ebs) | CSI driver, volume types, snapshots |

## Quick reference

```bash
# Configure kubectl for an EKS cluster
aws eks update-kubeconfig --region ap-southeast-1 --name my-cluster

# Verify
kubectl get nodes

# List all EKS clusters
aws eks list-clusters --region ap-southeast-1
```
