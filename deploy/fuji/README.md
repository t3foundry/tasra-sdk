# Tasra SDK documentation — deployment

The Starlight site in [`site/`](../../site), served from `web-server` at

> **<http://195.154.104.141:8081>**

and nowhere else. **There is no DNS name and no TLS** — the record was created and then removed on
2026-09-30 by operator decision, and no Nginx Proxy Manager host was ever created. The published
container port is the whole access path, which makes `ports:` in
[`compose.yaml`](compose.yaml) load-bearing rather than a convenience.

⚠⚠ **8081 is world-reachable and `ufw` does not show it.** Docker's rules live in the `DOCKER`
chain, which is consulted before ufw's `INPUT` rules, and this host's `DOCKER-USER` chain is empty —
so `ufw status` lists only 22/80/443 and a DENY on 81 while 8081 answers the internet. Do not read
that output as evidence the port is shut. Nothing served here is secret (it is public
documentation), but the port is plain http and unauthenticated.

⚠ **The built HTML still declares `https://sdk.t3-foundry.fuji.tasra.network` as its canonical
origin** (`site` in [`../../site/astro.config.mjs`](../../site/astro.config.mjs), asserted by
`build.sh`). That is deliberate: it is the right value if the name comes back, and it is inert while
nothing crawls an unadvertised IP. If this deployment is meant to stay IP-only, drop `site` and the
assertion in `build.sh`, then rebuild — do not leave it pointing at a name that will never exist.

To give it a name and TLS later, nothing needs rebuilding: `ingress.sh dns`, then `host`, then
`ssl`. The container already sits on the shared `proxy` network for exactly that.

Everything here reads [`deployment.json`](deployment.json), so a name or a path changes in one
place. No file in this directory holds a secret.

## What this stack is, and is not

It is **one nginx container serving static files**. No chain access, no database, no env file, no
volume. The image contains the entire site, so there is nothing to back up and `up.sh down` is
safe — the worst case is a rebuild.

It is **not part of the Fuji fleet**. `keykeeper-network/deploy/fuji/topology.json` drives the
keepers, verifiers, accountants and explorer, and its `render.sh` regenerates that compose file
with a "do not edit" banner — an addition there would be silently lost on the next render. This
stack lives beside them exactly as the Tasra Vault relayer and the health demo do: its own compose
project, its own ingress script.

## First deployment

```sh
cd deploy/fuji
./ingress.sh plan          # no credentials used — read this first
./ingress.sh dns           # the Cloudflare A record
dig +short sdk.t3-foundry.fuji.tasra.network    # must answer before the next step
./ingress.sh host          # the NPM proxy host, http only
./ingress.sh ssl           # Let's Encrypt, then force https

cd ../.. && ./deploy/fuji/build.sh all          # build + ship (from the repo root)
cd deploy/fuji
./up.sh sync && ./up.sh start
./up.sh status
```

⚠ **Order matters.** `ssl` before DNS resolves burns a Let's Encrypt attempt against the weekly
per-domain limit, and that limit is shared with the seventeen fleet names.

## Updating the site

```sh
./deploy/fuji/build.sh all     # from the repo root: rebuild, then ship
cd deploy/fuji && ./up.sh restart
```

⚠⚠ **`docker restart` would re-read nothing.** It does not load a newly imported image — the
container keeps the image id it was created with, so the site silently stays on the previous
build. `up.sh restart` is `up -d --force-recreate` for that reason.

## Things that bite

- ⚠⚠ **The build context is the repository root, not `site/`.** `site/sync.mjs` imports
  `../scripts/publication.mjs` and copies every file `publication.json` lists (README, CHANGELOG,
  LICENSE, SECURITY and all of `docs/`, `skills/`, `examples/`) into the content tree. A context of
  `site/` fails at `npm run sync` with a module-resolution error naming `publication.mjs`, which
  reads like a broken import rather than a wrong context.
- ⚠⚠ **`Dockerfile.docs.dockerignore` is load-bearing.** The repository is ~951 MB, 909 MB of it
  `node_modules`. BuildKit prefers a `<dockerfile>.dockerignore` over the context root's, which is
  why the ignore is scoped to this Dockerfile: a root `.dockerignore` would also change the context
  seen by the four images that consume this repository as a named `sdk` build context (the vault
  PWA and relayer, the health API, the explorer API), and those run their own `npm install`.
- ⚠⚠ **The canonical URL is baked in at build time** (`site` in `site/astro.config.mjs`). It is
  invisible in a browser and wrong only in crawlers and social previews, so `build.sh` fails the
  image when the built `index.html` does not carry the hostname from `deployment.json`.
- ⚠⚠ **A 200 on `/` does not prove search works.** Starlight's search is `/pagefind/*`, fetched by
  JavaScript. A missing index returns nothing for every query and no page looks broken. The
  Dockerfile asserts `pagefind.js` exists and `up.sh status` reports it separately.
- ⚠ **`nginx` maps `.ts` to `video/mp2t`.** The site publishes the SDK's TypeScript examples
  verbatim under `/examples/*.ts`; without the override in `nginx.conf` a reader who clicks one is
  offered a "video" download. The extensionless `LICENSE` has the same shape.
- ⚠ **Do not enable NPM's `caching_enabled` for this host.** The origin already answers
  `immutable` for content-hashed `/_astro/*` and `must-revalidate` for HTML, which is never
  content-hashed. Caching at the proxy flattens that and pins `index.html` to hashed assets a
  later deploy has already deleted: the page renders unstyled and rebuilding does not fix it.
- ⚠ **The A record must stay DNS-only (grey cloud).** Let's Encrypt HTTP-01 has to be answered by
  NPM at the origin. And this name is three labels below the apex, which Cloudflare's Universal
  SSL does not cover — so proxying would not supply a certificate in exchange either.
- ⚠ `ingress.sh` never modifies a DNS record or proxy host it did not create. One nginx serves
  ~35 unrelated production sites.
