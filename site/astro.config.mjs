import {defineConfig} from 'astro/config'
import starlight from '@astrojs/starlight'
export default defineConfig({
  // The public origin. Astro bakes this into the canonical <link>, the sitemap and the OpenGraph
  // URLs, none of which are visible in a browser — so a wrong value here is noticed only by a
  // crawler or a social preview. It must match deploy/fuji/deployment.json .service.dns, and
  // deploy/fuji/build.sh fails the image if the built index.html does not carry it.
  site: 'https://sdk.t3-foundry.fuji.tasra.network',
  vite: {
    preview: {
      // ⚠⚠ WITHOUT THIS THE DEPLOYED SITE ANSWERS 403 TO EVERY REQUEST THAT ARRIVES THROUGH A
      //    PROXY. Vite refuses any request whose Host header is not listed — the body says
      //    `Blocked request. This host ("…") is not allowed.` and points at vite.config.js, which
      //    this project does not have, so the advice does not match the repository. Only
      //    localhost/127.0.0.1 are allowed by default, which is why it looks fine when curled
      //    inside the container and 403s the moment Nginx Proxy Manager forwards Host: <fqdn>.
      //    ⚠ The public name must match `site` above and deploy/fuji/deployment.json .service.dns;
      //      the container name must match .service.container. Nothing checks that they agree.
      allowedHosts: ['sdk.t3-foundry.fuji.tasra.network', 'tasra-sdk-docs'],
    },
  },
  integrations: [starlight({
    title: 'Tasra SDK',
    logo: {src: './assets/tasra-logo.webp', alt: '', replacesTitle: false},
    favicon: '/favicon.png',
    customCss: ['./src/styles/brand.css'],
    description: 'Build credential-controlled TypeScript applications with verified threshold signing and encryption.',
    sidebar: [
      {label: 'Learn TASRA', items: [
        {label: 'Your learning path', slug: ''},
        {label: '1. Understand the basics', slug: 'basics'},
        {label: '2. Connect to TASRA', slug: 'getting-started'},
        {label: '3. Create your first slot', slug: 'create-slot'},
        {label: '4. Read your slot', slug: 'read-slot'},
        {label: '5. Manage your slot', slug: 'manage-slot'},
        {label: '6. Give a user access', slug: 'access-control'},
        {label: '7. Use your slot', slug: 'signing-and-encryption'},
      ]},
      {label: 'Build an application', collapsed: true, items: [
        {label: 'Shared Ethereum account', slug: 'shared-account'},
        {label: 'Encrypted notes', slug: 'encrypted-notes'},
        {label: 'Document signing', slug: 'document-signing'},
        {label: 'What the SDK handles', slug: 'flows'},
      ]},
      {label: 'Build with AI', collapsed: true, items: [
        {label: 'Skills and example prompts', slug: 'ai-development'},
      ]},
      {label: 'SDK reference', collapsed: true, items: [
        {label: 'Overview', slug: 'reference'},
        {label: 'Application client', slug: 'reference/app'},
        {label: 'Local storage (Node.js)', slug: 'reference/app-node'},
        {label: 'Core utilities', slug: 'reference/main'},
        {label: 'Chain access', slug: 'reference/chain'},
        {label: 'Chain tools (Node.js)', slug: 'reference/chain-node'},
        {label: 'Committee operations', slug: 'reference/committee'},
        {label: 'Credentials and OID4VP', slug: 'reference/oid4vp'},
        {label: 'Verifier integration', slug: 'reference/verifier-agent'},
      ]},
      {label: 'Go deeper', collapsed: true, items: [
        {label: 'Application API and recovery', slug: 'application-api'},
        {label: 'Multiple-person approvals', slug: 'native-approvals'},
        {label: 'Advanced clients and OAuth', slug: 'api'},
        {label: 'Chain operations', slug: 'chain'},
        {label: 'Architecture', slug: 'architecture'},
      ]},
      {label: 'Help and compatibility', collapsed: true, items: [
        {label: 'Install and compatibility', slug: 'installation'},
        {label: 'Network manifests', slug: 'fuji'},
        {label: 'Buy TASRA and fund a slot', slug: 'funding'},
        {label: 'Errors and recovery', slug: 'errors'},
        {label: 'Glossary', slug: 'glossary'},
      ]},
    ],
  })],
})
