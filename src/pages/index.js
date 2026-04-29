import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import clsx from 'clsx';
import styles from './index.module.css';

const topics = [
  {
    title: 'Kubernetes',
    icon: '⎈',
    description:
      'Deep dives into cluster architecture, workloads, ArgoCD GitOps, RBAC, and production operations.',
    link: '/kubernetes/intro',
    tag: 'Core',
  },
  {
    title: 'Cloudflare',
    icon: '🌐',
    description:
      'DNS management, Zero Trust tunnels, WAF rules, and Kubernetes integration patterns.',
    link: '/cloudflare/intro',
    tag: 'Networking',
  },
  {
    title: 'AWS',
    icon: '☁',
    description:
      'EKS cluster setup, IAM roles for service accounts, VPC design, and storage strategies.',
    link: '/aws/intro',
    tag: 'Cloud',
  },
];

function HeroSection() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <span className={styles.badge}>Infrastructure Documentation</span>
        <h1 className={styles.heroTitle}>
          Production-grade infra,
          <br />
          documented clearly.
        </h1>
        <p className={styles.heroSubtitle}>
          Reference guides for Kubernetes, Cloudflare, and AWS — built from
          real deployments.
        </p>
        <div className={styles.heroCta}>
          <Link className={clsx('button button--primary button--lg', styles.ctaPrimary)} to="/kubernetes/intro">
            Get started
          </Link>
          <Link className={clsx('button button--secondary button--lg', styles.ctaSecondary)} to="/aws/intro">
            AWS docs
          </Link>
        </div>
      </div>
    </section>
  );
}

function TopicCard({ title, icon, description, link, tag }) {
  return (
    <Link to={link} className={styles.card}>
      <div className={styles.cardIcon}>{icon}</div>
      <div>
        <span className={styles.cardTag}>{tag}</span>
        <h3 className={styles.cardTitle}>{title}</h3>
        <p className={styles.cardDescription}>{description}</p>
      </div>
      <span className={styles.cardArrow}>→</span>
    </Link>
  );
}

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <main>
        <HeroSection />
        <section className={styles.topics}>
          <div className={styles.topicsGrid}>
            {topics.map((t) => (
              <TopicCard key={t.title} {...t} />
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}
