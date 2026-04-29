// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  kubernetesSidebar: [
    {
      type: 'doc',
      id: 'kubernetes/intro',
      label: 'Overview',
    },
    {
      type: 'category',
      label: 'Core Concepts',
      collapsed: false,
      items: [
        'kubernetes/core/architecture',
        'kubernetes/core/workloads',
        'kubernetes/core/networking',
        'kubernetes/core/storage',
      ],
    },
    {
      type: 'category',
      label: 'ArgoCD',
      items: [
        'kubernetes/argocd/overview',
        'kubernetes/argocd/installation',
        'kubernetes/argocd/app-of-apps',
        'kubernetes/argocd/sync-policies',
      ],
    },
    {
      type: 'category',
      label: 'Operations',
      items: [
        'kubernetes/ops/monitoring',
        'kubernetes/ops/scaling',
        'kubernetes/ops/rbac',
      ],
    },
  ],

  cloudflareSidebar: [
    {
      type: 'doc',
      id: 'cloudflare/intro',
      label: 'Overview',
    },
    {
      type: 'category',
      label: 'DNS',
      collapsed: false,
      items: [
        'cloudflare/dns/records',
        'cloudflare/dns/proxying',
      ],
    },
    {
      type: 'category',
      label: 'Tunnels',
      items: [
        'cloudflare/tunnels/setup',
        'cloudflare/tunnels/k8s-integration',
      ],
    },
    {
      type: 'category',
      label: 'Security',
      items: [
        'cloudflare/security/waf',
        'cloudflare/security/zero-trust',
      ],
    },
  ],

  awsSidebar: [
    {
      type: 'doc',
      id: 'aws/intro',
      label: 'Overview',
    },
    {
      type: 'category',
      label: 'EKS',
      collapsed: false,
      items: [
        'aws/eks/cluster-setup',
        'aws/eks/node-groups',
        'aws/eks/iam-roles',
      ],
    },
    {
      type: 'category',
      label: 'Networking',
      items: [
        'aws/networking/vpc',
        'aws/networking/load-balancers',
      ],
    },
    {
      type: 'category',
      label: 'Storage',
      items: [
        'aws/storage/s3',
        'aws/storage/ebs',
      ],
    },
  ],
};

module.exports = sidebars;
