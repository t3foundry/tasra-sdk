import {defineConfig} from 'astro/config'
import starlight from '@astrojs/starlight'
export default defineConfig({
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
