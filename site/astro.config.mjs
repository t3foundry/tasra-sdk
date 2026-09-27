import {defineConfig} from 'astro/config'
import starlight from '@astrojs/starlight'
export default defineConfig({
  integrations: [starlight({
    title: 'Tasra SDK',
    description: 'Build credential-controlled TypeScript applications with verified threshold signing and encryption.',
    sidebar: [
      {label: 'Start building', items: [
        {label: 'Overview', slug: ''}, {label: 'Application API', slug: 'application-api'},
        {label: 'Install & compatibility', slug: 'installation'}, {label: 'Public deployment manifests', slug: 'fuji'},
      ]},
      {label: 'Complete TypeScript apps', items: [
        {label: 'A · Shared Ethereum account', slug: 'shared-account'},
        {label: 'B · Encrypted notes', slug: 'encrypted-notes'},
        {label: 'C · Document signing', slug: 'document-signing'},
      ]},
      {label: 'Recipes & concepts', items: [
        {label: 'Native approval quorum', slug: 'native-approvals'},
        {label: 'Errors and recovery', slug: 'errors'},
        {label: 'Choose an advanced client', slug: 'api'},
        {label: 'Architecture', slug: 'architecture'}, {label: 'Glossary', slug: 'glossary'},
      ]},
      {label: 'API reference', items: [{autogenerate: {directory: 'reference'}}]},
    ],
  })],
})
