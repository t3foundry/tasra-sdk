// unit tests for the DPoP helper (src/auth/dpop.ts).
//
// No network. What these pin is the ONE property everything else rests on: the proof's key
// must be the key the access token is bound to, so `jwkThumbprint` here and the verifier's
// RFC 7638 thumbprint must produce the SAME string for the same key. A mismatch presents as
// "DPoP proof jwk is not the key the access token is bound to" on every drawn verifier, with
// nothing in the client to point at.
//
// Run: `tsx test/dpop.ts` (part of `npm test`).

import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {
  createDpopKey,
  jwkThumbprint,
  accessTokenHash,
  auth0DpopSigner,
  isHeaderSafeNonce,
} from '../src/auth/dpop.js'
import {platformAudience, dpopHtu, isValidSessionId} from '../src/committee/oauth.js'
import {submitOauthResponse, VerifierAgentSessionError} from '../src/verifier-agent/index.js'
import {TasraError} from '../src/errors.js'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeSegment(jws: string, i: number): Record<string, unknown> {
  const seg = jws.split('.')[i]
  assert.ok(seg, `segment ${i} missing`)
  const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4))
  const json = Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString()
  return JSON.parse(json) as Record<string, unknown>
}

await check('RFC 7638 thumbprint matches the independently computed hash', async () => {
  // A worked RFC 7638 example shape: the canonical JSON is exactly the four required EC
  // members, lexicographic, no whitespace. Computing it here a SECOND way is what makes this
  // a known-answer test rather than a round-trip that would pass if both halves were wrong.
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
    y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
  }
  const canonical = `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`
  const expected = b64url(createHash('sha256').update(canonical).digest())
  assert.equal(await jwkThumbprint(jwk), expected)

  // ⚠ THE CROSS-LANGUAGE VECTOR. The SAME pair is pinned in the reference adapter
  // (`vc/adapters/oidc.rs::rfc_7638_thumbprint_vector`), computed there through
  // `ssi_jwk::JWK::thumbprint()`. Three implementations of RFC 7638 sit on this value — the
  // tenant's IdP (which writes it into `cnf.jkt`), the verifier (which recomputes it from
  // the proof header) and this one — and a disagreement presents as every proof being
  // refused, with nothing in the client to point at. Changing one side without the other is
  // exactly the drift this line catches.
  assert.equal(await jwkThumbprint(jwk), 'oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U')
})

await check('a generated key mints a proof carrying every RFC 9449 claim', async () => {
  const key = await createDpopKey()
  const token = 'header.payload.signature'
  const proof = await key.signer.proof({
    htm: 'POST',
    htu: 'https://agent.example/v1/sessions/s1/oauth-response',
    nonce: 'kk-nonce-abc',
    accessToken: token,
  })

  const header = decodeSegment(proof, 0)
  assert.equal(header.typ, 'dpop+jwt', 'RFC 9449 §4.2 requires this typ')
  assert.equal(header.alg, 'ES256')
  // The public key rides in the header — and ONLY the public half. A `d` here would be the
  // client leaking its own secret to every verifier.
  const jwk = header.jwk as Record<string, unknown>
  assert.equal(jwk.kty, 'EC')
  assert.equal(jwk.crv, 'P-256')
  assert.ok(!('d' in jwk), 'a proof must never carry private key material')

  const payload = decodeSegment(proof, 1)
  assert.equal(payload.htm, 'POST')
  assert.equal(payload.htu, 'https://agent.example/v1/sessions/s1/oauth-response')
  assert.equal(payload.nonce, 'kk-nonce-abc')
  assert.equal(payload.ath, await accessTokenHash(token))
  assert.ok(typeof payload.jti === 'string' && payload.jti.length > 0)
  assert.ok(typeof payload.iat === 'number')
})

await check('the header jwk is the key the thumbprint names', async () => {
  // THE binding, from the client side: an IdP puts `thumbprint()` in the token's `cnf.jkt`,
  // and every verifier recomputes it from the proof's header `jwk`. If these two ever
  // disagreed, every proof this SDK mints would be refused.
  const key = await createDpopKey()
  const proof = await key.signer.proof({
    htm: 'POST',
    htu: 'https://agent.example/v1/sessions/s1/oauth-response',
    nonce: 'n',
    accessToken: 't',
  })
  const headerJwk = decodeSegment(proof, 0).jwk as Record<string, unknown>
  assert.equal(await jwkThumbprint(headerJwk), await key.thumbprint())
})

await check('ath is the base64url sha256 of the token, not of anything else', async () => {
  const token = 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJhbGljZSJ9.sig'
  const expected = b64url(createHash('sha256').update(token, 'ascii').digest())
  assert.equal(await accessTokenHash(token), expected)
  // A different token must produce a different hash — otherwise `ath` binds nothing.
  assert.notEqual(await accessTokenHash(token), await accessTokenHash(`${token}x`))
})

await check('each proof is fresh: jti never repeats', async () => {
  const key = await createDpopKey()
  const args = {
    htm: 'POST',
    htu: 'https://agent.example/v1/sessions/s1/oauth-response',
    nonce: 'n',
    accessToken: 't',
  }
  const seen = new Set<string>()
  for (let i = 0; i < 8; i++) {
    const jti = decodeSegment(await key.signer.proof(args), 1).jti as string
    assert.ok(!seen.has(jti), 'jti must be fresh per proof')
    seen.add(jti)
  }
})

await check('a token-request proof carries neither ath nor an unrequested nonce', async () => {
  // RFC 9449 §5: a proof sent to the IdP's token endpoint has no access token to hash, and
  // carries `nonce` only when the IdP challenged for one. An `ath` there is refused by the
  // IdP, so the SDK must be able to mint this proof or a `createDpopKey` app cannot obtain a
  // token at all.
  const key = await createDpopKey()
  const tokenEndpoint = 'https://idp.example/realms/kk/protocol/openid-connect/token'
  const bare = decodeSegment(await key.tokenRequestProof({htm: 'POST', htu: tokenEndpoint}), 1)
  assert.equal(bare.htm, 'POST')
  assert.equal(bare.htu, tokenEndpoint)
  assert.ok(!('ath' in bare), 'a token request has no token to hash')
  assert.ok(!('nonce' in bare), 'no nonce was asked for, so none is sent')
  assert.ok(typeof bare.jti === 'string' && typeof bare.iat === 'number')

  const challenged = decodeSegment(
    await key.tokenRequestProof({htm: 'POST', htu: tokenEndpoint, nonce: 'idp-nonce'}),
    1,
  )
  assert.equal(challenged.nonce, 'idp-nonce')
  assert.ok(!('ath' in challenged))

  // The same key presents the token it obtained — and THAT proof carries both claims.
  const present = decodeSegment(
    await key.signer.proof({
      htm: 'POST',
      htu: 'https://agent.example/v1/sessions/s1/oauth-response',
      nonce: 'kk',
      accessToken: 'tok',
    }),
    1,
  )
  assert.equal(present.nonce, 'kk')
  assert.equal(present.ath, await accessTokenHash('tok'))

  // One key, one thumbprint across both proofs — what the IdP writes into `cnf.jkt` is what
  // every verifier recomputes from the presenting proof.
  const tokenHeader = decodeSegment(await key.tokenRequestProof({htm: 'POST', htu: tokenEndpoint}), 0)
  assert.equal(await jwkThumbprint(tokenHeader.jwk as JsonWebKey), await key.thumbprint())
})

await check('the auth0 adapter forwards the URL, method and nonce unchanged', async () => {
  // The Auth0 SDK owns the key, so all this wrapper may do is pass our values through. A
  // transformation here (a trailing slash, a lower-cased method) would make the proof's
  // `htu`/`htm` disagree with what every verifier derives.
  let seen: Record<string, unknown> | undefined
  const signer = auth0DpopSigner(async (a) => {
    seen = a as unknown as Record<string, unknown>
    return 'proof-from-auth0'
  })
  const out = await signer.proof({
    htm: 'POST',
    htu: 'https://agent.example/v1/sessions/s1/oauth-response',
    nonce: 'kk-nonce',
    accessToken: 'tok',
  })
  assert.equal(out, 'proof-from-auth0')
  assert.deepEqual(seen, {
    url: 'https://agent.example/v1/sessions/s1/oauth-response',
    method: 'POST',
    nonce: 'kk-nonce',
    accessToken: 'tok',
  })
})

await check('a non-EC key is refused rather than thumbprinted wrongly', async () => {
  await assert.rejects(() => jwkThumbprint({kty: 'RSA', n: 'x', e: 'AQAB'}))
  await assert.rejects(() => jwkThumbprint({kty: 'EC', crv: 'P-256', x: 'x'}))
})

await check('a header-unsafe nonce is detectable before it breaks a challenge', () => {
  assert.equal(isHeaderSafeNonce('kk-nonce_abc123'), true)
  assert.equal(isHeaderSafeNonce(''), false)
  assert.equal(isHeaderSafeNonce('has space'), false)
  assert.equal(isHeaderSafeNonce('has\nnewline'), false)
})

// ─── derivation vectors ────────────────────────────────────────────
//
// ⚠ These are THE SAME vectors as `keykeeper-committee/src/oauth.rs::{audience_vectors,
// htu_vectors, the_origin_is_normalised_so_one_deployment_has_one_audience}`. A tenant
// registers the audience with its IdP from THIS side; every drawn verifier derives it from
// the reference implementation. A divergence means every token is refused for the wrong audience, and the
// tenant has no way to see why.

await check('platformAudience vectors match the reference implementation derivation', () => {
  assert.equal(
    platformAudience('https://agent.kk.example', 43113),
    'https://agent.kk.example/authz/43113',
  )
  assert.equal(
    platformAudience('https://agent.kk.example:8443', 43114),
    'https://agent.kk.example:8443/authz/43114',
  )
  // The chain id separates deployments of one platform.
  assert.notEqual(
    platformAudience('https://agent.kk.example', 43113),
    platformAudience('https://agent.kk.example', 43114),
  )
})

await check('dpopHtu vectors match the reference implementation derivation', () => {
  assert.equal(
    dpopHtu('https://agent.kk.example', 'sess-oauth_1'),
    'https://agent.kk.example/v1/sessions/sess-oauth_1/oauth-response',
  )
  assert.equal(
    dpopHtu(
      'https://agent.kk.example:8443/',
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    ),
    'https://agent.kk.example:8443/v1/sessions/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08/oauth-response',
  )
})

await check('a session id that is not one plain path segment is refused, as in Rust', () => {
  // Same list as `a_session_id_that_is_not_one_plain_path_segment_is_refused`.
  for (const bad of ['', 'a/b', '..', '.', 'a.b', 'a%2Fb', 'a?b', 'a#b', 'a b', 'sess\u00e9', 'a'.repeat(129)]) {
    assert.equal(isValidSessionId(bad), false, JSON.stringify(bad))
    assert.throws(() => dpopHtu('https://agent.kk.example', bad), TasraError)
  }
  assert.equal(isValidSessionId('a'.repeat(128)), true)
})

await check('one deployment has ONE audience whatever the origin spelling', () => {
  for (const spelling of [
    'https://Agent.KK.Example/',
    'HTTPS://agent.kk.example',
    '  https://agent.kk.example  ',
  ]) {
    assert.equal(
      platformAudience(spelling, 43113),
      'https://agent.kk.example/authz/43113',
      spelling,
    )
    assert.equal(dpopHtu(spelling, 's1'), 'https://agent.kk.example/v1/sessions/s1/oauth-response')
  }
})

// ─── submitOauthResponse over a stubbed fetch ───────────────────────────────

type Seen = {url: string; headers: Record<string, string>}

async function withFetch(
  answer: (seen: Seen) => Response,
  fn: (calls: Seen[]) => Promise<void>,
): Promise<void> {
  const realFetch = globalThis.fetch
  const calls: Seen[] = []
  globalThis.fetch = (async (url: string, init?: {headers?: Record<string, string>}) => {
    const seen = {url, headers: init?.headers ?? {}}
    calls.push(seen)
    return answer(seen)
  }) as typeof fetch
  try {
    await fn(calls)
  } finally {
    globalThis.fetch = realFetch
  }
}

const AGENT = 'https://agent.kk.example'
const SESSION = '5e55a1d0c0ffee'

await check('the URL submitOauthResponse posts to is the htu it signs over', async () => {
  // Item 1's property from the client side: a client calling the agent at its public origin
  // presents a proof whose `htu` IS the request URL (RFC 9449 §4.3), so a conformant DPoP
  // library deriving `htu` from the URL agrees with every verifier.
  const key = await createDpopKey()
  const htu = dpopHtu(AGENT, SESSION)
  await withFetch(
    () => Response.json({status: 'accepted'}),
    async (calls) => {
      await submitOauthResponse(AGENT, {
        sessionId: SESSION,
        pollSecret: 'ps',
        accessToken: 'tok',
        nonce: 'kk-nonce',
        dpopHtu: htu,
        signer: key.signer,
      })
      assert.equal(calls.length, 1)
      assert.equal(calls[0]!.url, htu)
      const proof = decodeSegment(calls[0]!.headers.DPoP!, 1)
      assert.equal(proof.htu, calls[0]!.url)
      assert.equal(proof.nonce, 'kk-nonce')
      assert.equal(calls[0]!.headers['X-Poll-Secret'], 'ps')
      assert.equal(calls[0]!.headers.Authorization, 'DPoP tok')
    },
  )
})

await check('a refused delivery throws refused with the reason, and is not retryable', async () => {
  const key = await createDpopKey()
  await withFetch(
    () =>
      Response.json(
        {status: 'failed', error: 'verifier fan-out failed: quorum not met (verifier 1: HTTP 403: dcql: not satisfied)'},
        {status: 403},
      ),
    async () => {
      await assert.rejects(
        submitOauthResponse(AGENT, {
          sessionId: SESSION,
          pollSecret: 'ps',
          accessToken: 'tok',
          nonce: 'n',
          dpopHtu: dpopHtu(AGENT, SESSION),
          signer: key.signer,
        }),
        (e: unknown) => {
          assert.ok(e instanceof VerifierAgentSessionError, String(e))
          assert.equal(e.kind, 'refused')
          assert.equal(e.retryable, false)
          assert.equal(e.httpStatus, 403)
          assert.match(e.message, /not satisfied/)
          return true
        },
      )
    },
  )
  // An unreachable quorum also FAILED the session: still `refused`, never "poll again".
  await withFetch(
    () => Response.json({status: 'failed', error: 'quorum unreachable before disclosure'}, {status: 503}),
    async () => {
      await assert.rejects(
        submitOauthResponse(AGENT, {
          sessionId: SESSION,
          pollSecret: 'ps',
          accessToken: 'tok',
          nonce: 'n',
          dpopHtu: dpopHtu(AGENT, SESSION),
          signer: key.signer,
        }),
        (e: unknown) => e instanceof VerifierAgentSessionError && e.kind === 'refused' && !e.retryable,
      )
    },
  )
  // An ordinary 503 with no failed session behind it stays retryable.
  await withFetch(
    () => new Response('session store unavailable', {status: 503}),
    async () => {
      await assert.rejects(
        submitOauthResponse(AGENT, {
          sessionId: SESSION,
          pollSecret: 'ps',
          accessToken: 'tok',
          nonce: 'n',
          dpopHtu: dpopHtu(AGENT, SESSION),
          signer: key.signer,
        }),
        (e: unknown) => e instanceof VerifierAgentSessionError && e.kind === 'unavailable' && e.retryable,
      )
    },
  )
})

console.log(`\nDPoP helper: ${passed}/${passed} passed`)
