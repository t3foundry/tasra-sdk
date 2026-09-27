import { preview } from './preview.js'
import { digest, people, type Person, type PublicRequest } from '../model.js'
import {
  importWallet,
  present,
  declineProof,
  type DemoWallet,
  type PublicSession,
} from './wallet.js'
const app = document.querySelector<HTMLElement>('#app')!
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )
const name = (p: string) => p[0]!.toUpperCase() + p.slice(1)
const token = new URLSearchParams(location.hash.slice(1)).get('sender')
if (token) {
  sessionStorage.setItem('sender', token)
  history.replaceState(null, '', location.pathname)
}
const sender = sessionStorage.getItem('sender')
function notice(message: string) {
  document.querySelector('#notice')!.textContent = message
}
async function api<T>(path: string, data?: unknown, owner = false): Promise<T> {
  const response = await fetch('/api' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      ...(data === undefined ? {} : { 'content-type': 'application/json' }),
      ...(owner ? { authorization: 'Bearer ' + sender } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Request failed')
  return result as T
}
const base64 = (bytes: Uint8Array) => {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text)
}
const file = (id: string) =>
  document.querySelector<HTMLInputElement>('#' + id)!.files?.[0]
const value = (id: string) =>
  document.querySelector<HTMLInputElement>('#' + id)!.value
const on = (id: string, handler: () => Promise<void>) =>
  document
    .querySelector('#' + id)
    ?.addEventListener(
      'click',
      () => void handler().catch((e) => notice(e.message)),
    )
const badge = (r: PublicRequest) =>
  `<span class="badge ${r.status === 'completed' ? 'done' : ['declined', 'cancelled'].includes(r.status) ? 'closed' : ''}">${esc(r.status.replaceAll('_', ' '))}</span>`
const timeline = (r: PublicRequest) =>
  `<section class="panel"><h2>Activity</h2><ol class="timeline">${r.history.map((h) => `<li>${esc(h.person ? name(h.person) + ': ' : '')}${esc(h.event)}<time>${esc(new Date(h.at).toLocaleString())}</time></li>`).join('')}</ol></section>`
const downloads = (r: PublicRequest) =>
  `<div class="actions"><a class="button small" href="/api/requests/${r.manifest.requestId}/pdf" target="_blank" rel="noopener">Open PDF</a><a class="button small" href="/api/requests/${r.manifest.requestId}/request">Save request</a>${r.status === 'completed' ? `<a class="button small" href="/api/requests/${r.manifest.requestId}/bundle">Download signatures</a>` : ''}</div>`
const recipients = (r: PublicRequest) =>
  people
    .map(
      (p) =>
        `<div class="person"><div class="avatar">${name(p)[0]}</div><div><p>${name(p)}</p><small>${esc(r.signers[p].phase.replaceAll('_', ' '))}</small></div></div>`,
    )
    .join('')
let selected: PublicRequest | undefined
async function dashboard() {
  if (!sender) {
    app.innerHTML =
      '<h1>Your signing workspace</h1><p>Open the private sender-console link printed by <code>npm start</code>, or open your Alice or Bob invitation.</p>'
    return
  }
  const list = await api<PublicRequest[]>('/requests', undefined, true)
  if (selected)
    selected = list.find(
      (r) => r.manifest.requestId === selected!.manifest.requestId,
    )
  app.innerHTML = `<div class="topline"><div><div class="eyebrow">Documents</div><h1>From draft to signed.</h1><p class="sub">Upload a PDF. Invite Alice, then Bob. Keep a verifiable record of their approval.</p></div></div><div class="grid"><div class="stack"><section class="panel"><h2>Send a document</h2><div class="row"><div class="field"><label for="title">Document title</label><input id="title" type="text" value="Consulting agreement" maxlength="120"></div><div class="field"><label for="version">Version</label><input id="version" type="number" value="1" min="1"></div></div><div class="drop"><p>Choose your PDF · up to 8 MB</p><input id="pdf" type="file" accept="application/pdf"><p class="hint">Or start with the included sample agreement.</p><button id="sample" class="small">Use sample PDF</button></div><p id="chosen" class="hint"></p><p class="hint">Signing order: Alice → Bob. Sending freezes the PDF, version and recipients.</p><button id="send" class="primary">Create signing request</button></section><section class="panel"><h2>Your requests</h2>${list.length ? list.map((r) => `<div class="request"><div><strong>${esc(r.manifest.title)}</strong><small>Version ${r.manifest.version} · ${esc(r.manifest.requestId.slice(0, 8))}</small></div><button data-id="${r.manifest.requestId}" class="small">${esc(r.status.replaceAll('_', ' '))}</button></div>`).join('') : '<p class="empty">Your first request will appear here.</p>'}</section></div><aside class="side stack">${selected ? `<section class="panel"><h2>${esc(selected.manifest.title)}</h2>${badge(selected)}${recipients(selected)}${people.map((p) => `<h3>${name(p)}’s invitation</h3><div class="linkbox"><a href="/sign/${selected!.manifest.requestId}/${p}" target="_blank" rel="noopener">${location.origin}/sign/${selected!.manifest.requestId}/${p}</a></div><button class="small" id="copy-${p}">Copy ${name(p)}’s link</button><div class="divider"></div>`).join('')}${downloads(selected)}${['awaiting_alice', 'awaiting_bob'].includes(selected.status) ? '<div class="divider"></div><button id="cancel" class="small">Cancel request</button>' : ''}</section>${timeline(selected)}` : '<section class="panel"><h2>Two people. One agreement.</h2><p class="hint">Each person reviews the same frozen PDF and approves with their own wallet. The app saves two independent signatures.</p><p class="hint">Demo wallet files are created by <code>npm run setup</code>. Give each signer only their own file.</p></section>'}</aside></div>`
  let bytes: Uint8Array | undefined
  document.querySelector('#pdf')!.addEventListener('change', () => {
    bytes = undefined
    document.querySelector('#chosen')!.textContent = file('pdf')?.name ?? ''
  })
  on('sample', async () => {
    bytes = new Uint8Array(await (await fetch('/sample.pdf')).arrayBuffer())
    document.querySelector('#chosen')!.textContent = 'Sample agreement selected'
  })
  on('send', async () => {
    const button = document.querySelector<HTMLButtonElement>('#send')!
    button.disabled = true
    try {
      const upload =
        bytes ??
        (file('pdf')
          ? new Uint8Array(await file('pdf')!.arrayBuffer())
          : undefined)
      if (!upload) throw new Error('Choose a PDF first')
      const fingerprint = JSON.stringify({
        hash: await digest(upload),
        title: value('title'),
        version: value('version'),
      })
      const pending = JSON.parse(
        sessionStorage.getItem('pending-request') ?? 'null',
      ) as { fingerprint: string; id: string } | null
      const id =
        pending?.fingerprint === fingerprint ? pending.id : crypto.randomUUID()
      sessionStorage.setItem(
        'pending-request',
        JSON.stringify({ fingerprint, id }),
      )
      selected = await api<PublicRequest>(
        '/requests',
        {
          id,
          title: value('title'),
          version: Number(value('version')),
          pdfBase64: base64(upload),
        },
        true,
      )
      sessionStorage.removeItem('pending-request')
      notice('Request created. Share each signer’s invitation.')
      await dashboard()
    } finally {
      button.disabled = false
    }
  })
  for (const button of Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-id]'),
  ))
    button.onclick = () => {
      selected = list.find((r) => r.manifest.requestId === button.dataset.id)
      void dashboard().catch((e) => notice(e.message))
    }
  for (const person of people)
    on('copy-' + person, async () => {
      await navigator.clipboard.writeText(
        `${location.origin}/sign/${selected!.manifest.requestId}/${person}`,
      )
      notice('Invitation copied')
    })
  on('cancel', async () => {
    await api(`/requests/${selected!.manifest.requestId}/cancel`, {}, true)
    await dashboard()
  })
}
async function signer(id: string, person: Person) {
  const config = await api<{ verifierAgentUrl: string }>('/config')
  let wallet: DemoWallet | undefined,
    consent = false,
    busy = false,
    previous = '',
    reviewedHash = '',
    reviewedBytes: Uint8Array | undefined
  async function render() {
    if (busy) return
    const r = await api<PublicRequest>('/requests/' + id),
      serialized = JSON.stringify(r)
    if (serialized === previous) return
    if (!reviewedHash) {
      reviewedBytes = new Uint8Array(
        await (await fetch(`/api/requests/${id}/pdf`)).arrayBuffer(),
      )
      reviewedHash = await digest(reviewedBytes)
      if (reviewedHash !== r.manifest.documentSha256)
        throw new Error('The PDF does not match the signing request')
    }
    previous = serialized
    const state = r.signers[person],
      closed = ['completed', 'cancelled', 'declined'].includes(r.status),
      blocked =
        closed ||
        state.phase === 'signed' ||
        ['uncertain', 'opening', 'signing'].includes(state.phase) ||
        (person === 'bob' && r.signers.alice.phase !== 'signed')
    app.innerHTML = `<div class="topline"><div><div class="eyebrow">Signature request · ${name(person)}</div><h1>${esc(r.manifest.title)}</h1><p class="sub">Please review the document, then confirm your approval.</p><div class="meta">Version ${r.manifest.version} · Two signatures required</div></div>${badge(r)}</div><div class="grid"><section class="panel pdf"><div class="pdf-head"><span>${esc(r.manifest.title)} · v${r.manifest.version}</span><a href="/api/requests/${id}/pdf" target="_blank" rel="noopener">Open PDF ↗</a></div><div id="preview" aria-label="Document preview">Loading PDF…</div><small>Review the complete document before signing.</small></section><aside class="side stack"><section class="panel"><h2>${state.phase === 'signed' ? 'Your signature is saved' : 'Your signature'}</h2>${recipients(r)}${state.phase === 'uncertain' ? '<p class="error">The signing outcome needs reconciliation. Keep this request; do not create a replacement signature.</p>' : ''}${person === 'bob' && r.signers.alice.phase !== 'signed' ? '<p class="hint">Waiting for Alice to sign. This page updates automatically.</p>' : ''}${!blocked ? `<div class="wallet"><label for="wallet">Your demo wallet file</label><input id="wallet" type="file" accept="application/json"><p id="wallet-name">${wallet ? 'Loaded: ' + esc(name(wallet.name)) : 'Choose the private file provided to you.'}</p><p class="hint">The wallet key stays in this browser tab. Only an encrypted credential presentation is sent.</p></div><label class="consent"><input id="consent" type="checkbox" ${consent ? 'checked' : ''}>I have reviewed this PDF and approve this version.</label><button id="sign" class="primary wide" ${!wallet || !consent ? 'disabled' : ''}>Approve and sign</button><button id="decline" class="wide small" ${!wallet ? 'disabled' : ''}>Decline document</button>` : state.phase === 'signed' ? '<p class="success">Your approval has been verified and saved.</p>' : ''}<div class="divider"></div>${downloads(r)}<p class="hint">Document SHA-256</p><p class="fingerprint">${r.manifest.documentSha256}</p></section>${timeline(r)}</aside></div>`
    const enable = () => {
      document.querySelector<HTMLButtonElement>('#sign')!.disabled =
        !wallet || !consent
      document.querySelector<HTMLButtonElement>('#decline')!.disabled = !wallet
    }
    document.querySelector('#wallet')?.addEventListener(
      'change',
      () =>
        void (async () => {
          wallet = undefined
          enable()
          const f = file('wallet')
          if (!f) return
          wallet = importWallet(await f.text())
          document.querySelector('#wallet-name')!.textContent =
            'Loaded: ' + name(wallet.name)
          enable()
        })().catch((e) => notice(e.message)),
    )
    document.querySelector('#consent')?.addEventListener('change', () => {
      consent = document.querySelector<HTMLInputElement>('#consent')!.checked
      enable()
    })
    on('sign', async () => {
      busy = true
      document.querySelector<HTMLButtonElement>('#sign')!.disabled = true
      notice('Requesting your wallet approval…')
      try {
        const prepared = await api<PublicRequest>(
          `/requests/${id}/${person}/prepare`,
          { documentSha256: reviewedHash },
        )
        const attemptId = prepared.signers[person].attemptId!
        const session = await api<PublicSession>(
          `/requests/${id}/${person}/session`,
          { attemptId },
        )
        const transport: typeof fetch = async (input, init) => {
          const result = await api<{
            status: number
            contentType: string
            body: string
          }>(`/requests/${id}/${person}/transport`, {
            attemptId,
            url: String(input),
            method: init?.method ?? 'GET',
            body: init?.body?.toString(),
          })
          return new Response(result.status === 204 ? null : result.body, {
            status: result.status,
            headers: { 'content-type': result.contentType ?? 'text/plain' },
          })
        }
        if (session.status === 'pending')
          await present(
            wallet!,
            r.manifest,
            person,
            session,
            config.verifierAgentUrl,
            transport,
          )
        notice('Verifying your approval and saving the signature…')
        await api(`/requests/${id}/${person}/complete`, { attemptId })
        notice('Signature verified and saved')
      } finally {
        busy = false
        previous = ''
        await render()
      }
    })
    on('decline', async () => {
      busy = true
      try {
        await api(`/requests/${id}/${person}/decline`, {
          proof: declineProof(wallet!, r.manifest, person),
        })
        notice('Document declined')
      } finally {
        busy = false
        previous = ''
        await render()
      }
    })
    try {
      await preview(reviewedBytes!)
    } catch {
      document.querySelector('#preview')!.textContent =
        'Preview unavailable. Use Open PDF to review the original document.'
    }
  }
  await render()
  setInterval(() => void render().catch((e) => notice(e.message)), 2500)
}
function verification() {
  app.innerHTML =
    '<div class="verify"><div class="eyebrow">Independent verification</div><h1>Check the agreement.</h1><p class="sub">Use the original PDF, the request you saved before signing, and the downloaded signature bundle. Verification checks both signatures against the current on-chain keys.</p><section class="panel"><div class="field"><label for="original">Original PDF</label><input id="original" type="file" accept="application/pdf"></div><div class="field"><label for="expected">Previously saved request.json</label><input id="expected" type="file" accept="application/json"></div><div class="field"><label for="bundle">signatures.json</label><input id="bundle" type="file" accept="application/json"></div><button id="verify" class="primary">Verify both signatures</button><p id="result" role="status"></p><p class="hint">Keep request.json from a trusted source. Inferring the expected request from an untrusted bundle cannot detect a substituted agreement. This check is not an archival timestamp or a legal certification.</p></section></div>'
  on('verify', async () => {
    const result = document.querySelector('#result')!
    result.textContent = 'Checking…'
    result.className = ''
    try {
      if (!file('original') || !file('expected') || !file('bundle'))
        throw new Error('Select all three files')
      await api('/verify', {
        pdfBase64: base64(
          new Uint8Array(await file('original')!.arrayBuffer()),
        ),
        expected: JSON.parse(await file('expected')!.text()),
        bundle: JSON.parse(await file('bundle')!.text()),
      })
      result.className = 'success'
      result.textContent =
        'Verified. Alice and Bob signed this exact document and request.'
    } catch (e) {
      result.className = 'error'
      result.textContent =
        e instanceof Error ? e.message : 'Verification failed'
    }
  })
}
const route = /^\/sign\/([0-9a-f-]{36})\/(alice|bob)$/i.exec(location.pathname)
void (async () => {
  if (route) await signer(route[1]!, route[2] as Person)
  else if (location.pathname === '/verify') verification()
  else await dashboard()
})().catch((e) => {
  app.innerHTML =
    '<h1>Unable to open this request</h1><p>' + esc(e.message) + '</p>'
})
