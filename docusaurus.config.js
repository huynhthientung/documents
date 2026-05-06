// @ts-check
const { themes: prismThemes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Huynh Thien Tung — Docs',
  tagline: 'Infrastructure, Kubernetes, Cloud — documented cleanly.',
  favicon: 'img/favicon.ico',

  url: 'https://docs.huynhthientung.com',
  baseUrl: '/',

  organizationName: 'huynhthientung',
  projectName: 'lespaul-argo_cd',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/',
          showLastUpdateTime: true,
          showLastUpdateAuthor: false,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
        },
      }),
    ],
  ],

  plugins: [
    async function tailwindPlugin() {
      return {
        name: 'tailwind-plugin',
        configurePostCss(postcssOptions) {
          postcssOptions.plugins.push(require('tailwindcss'));
          postcssOptions.plugins.push(require('autoprefixer'));
          return postcssOptions;
        },
      };
    },
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },

      image: 'img/social-card.png',

      navbar: {
        title: 'Huynh Thien Tung',
        logo: {
          alt: 'Logo',
          src: 'img/logo.svg',
          srcDark: 'img/logo-dark.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'kubernetesSidebar',
            position: 'left',
            label: 'Kubernetes',
          },
          {
            type: 'docSidebar',
            sidebarId: 'cloudflareSidebar',
            position: 'left',
            label: 'Cloudflare',
          },
          {
            type: 'docSidebar',
            sidebarId: 'awsSidebar',
            position: 'left',
            label: 'AWS',
          },
          {
            href: 'https://huynhthientung.com',
            label: 'About',
            position: 'right',
          },
          {
            href: 'https://github.com/huynhthientung',
            label: 'GitHub',
            position: 'right',
          },
        ],
        hideOnScroll: true,
      },

      footer: {
        style: 'light',
        links: [
          {
            title: 'Docs',
            items: [
              { label: 'Kubernetes', to: '/kubernetes/intro' },
              { label: 'Cloudflare', to: '/cloudflare/intro' },
              { label: 'AWS', to: '/aws/intro' },
            ],
          },
          {
            title: 'Connect',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/huynhthientung',
              },
              {
                label: 'LinkedIn',
                href: 'https://www.linkedin.com/in/huynhthientung',
              },
            ],
          },
        ],
        copyright: `© ${new Date().getFullYear()} Huynh Thien Tung. Built with Docusaurus.`,
      },

      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: [
          'bash',
          'yaml',
          'json',
          'docker',
          'nginx',
          'hcl',
          'toml',
        ],
      },

      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4,
      },

      docs: {
        sidebar: {
          hideable: true,
          autoCollapseCategories: true,
        },
      },
    }),
};

module.exports = config;
