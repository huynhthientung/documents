---
id: vpc
title: VPC Design
tags: [aws, vpc, networking, subnets]
---

# VPC Design

## Standard layout

```
VPC: 10.0.0.0/16
├── Public subnets (one per AZ)
│   ├── 10.0.0.0/24  ap-southeast-1a
│   ├── 10.0.1.0/24  ap-southeast-1b
│   └── 10.0.2.0/24  ap-southeast-1c
│   └── Resources: NAT Gateways, Load Balancers
│
└── Private subnets (one per AZ)
    ├── 10.0.10.0/23  ap-southeast-1a
    ├── 10.0.12.0/23  ap-southeast-1b
    └── 10.0.14.0/23  ap-southeast-1c
    └── Resources: EKS nodes, RDS, ElastiCache
```

## Terraform

```hcl title="vpc.tf"
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "production-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["ap-southeast-1a", "ap-southeast-1b", "ap-southeast-1c"]
  private_subnets = ["10.0.10.0/23", "10.0.12.0/23", "10.0.14.0/23"]
  public_subnets  = ["10.0.0.0/24", "10.0.1.0/24", "10.0.2.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = false   # one per AZ for HA
  enable_vpn_gateway     = false
  enable_dns_hostnames   = true
  enable_dns_support     = true

  # Required tags for EKS
  private_subnet_tags = {
    "kubernetes.io/cluster/my-cluster" = "owned"
    "kubernetes.io/role/internal-elb"  = "1"
    "karpenter.sh/discovery"           = "my-cluster"
  }

  public_subnet_tags = {
    "kubernetes.io/cluster/my-cluster" = "owned"
    "kubernetes.io/role/elb"           = "1"
  }

  tags = {
    Terraform   = "true"
    Environment = "production"
  }
}
```

## NAT Gateway cost

NAT Gateways are priced per GB of data processed. For high-egress workloads, consider:

1. **VPC Endpoints** for S3 and DynamoDB — free, bypasses NAT
2. **Single NAT Gateway** in dev/staging — saves ~$100/month at the cost of AZ redundancy

```hcl
# Free VPC endpoints for common services
resource "aws_vpc_endpoint" "s3" {
  vpc_id       = module.vpc.vpc_id
  service_name = "com.amazonaws.ap-southeast-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids = module.vpc.private_route_table_ids
}
```

## Security Groups

Prefer Security Group rules over NACLs for stateful, application-layer filtering.

```hcl
resource "aws_security_group" "workers" {
  name   = "eks-workers"
  vpc_id = module.vpc.vpc_id

  # Nodes communicate with each other
  ingress {
    from_port = 0
    to_port   = 0
    protocol  = "-1"
    self      = true
  }

  # Control plane to workers
  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.cluster.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
```
