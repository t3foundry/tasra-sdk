# Tasra SDK documentation — deployment

The Starlight site in [`site/`](../../site), served from `web-server` behind Nginx Proxy Manager at
**<https://sdk.t3-foundry.fuji.tasra.network>**.

**Nothing is published to the host.** The container declares port 80 with `expose` and NPM reaches
it by container name on the shared `proxy` network — the same way `kk-fuji-explorer-web` and
`tasra-health-web` are reached. So the proxy is the only way in, and the site needs *both* of these
to be reachable:

| | |
|---|---|
| **The DNS record** | `ingress.sh dns` — an A record to `195.154.104.141`, DNS-only (grey cloud). |
| **The NPM proxy host** | forwarding to **`tasra-sdk-docs:80`**, then a Let's Encrypt cert on its SSL tab. |

⚠⚠ **The NPM host must forward to port 80, not 8081.** An earlier revision published `8081:80` on
the host; a proxy host pointed at `tasra-sdk-docs:8081` answers **502**, because 8081 only ever
existed in the *host's* namespace as a mapping — nothing has ever listened on 8081 *inside* the
container. `up.sh status` probes `tasra-sdk-docs:80` from inside the NPM container precisely to
tell this case apart from a genuinely broken site.

⚠ **Host port 80 is not available to publish here**, now or ever: NPM (`traefik-app-1`) owns
`0.0.0.0:80` and `:443` for ~35 sites. `ports: ["80:80"]` would fail with "address already in use".

⚠ **If you ever publish a host port again, `ufw` will not show it.** Docker writes its rules into
the `DOCKER` chain, consulted before ufw's `INPUT` rules, and this host's `DOCKER-USER` chain is
empty — so a published port answers the internet while `ufw status` still lists only 22/80/443 and a
DENY on 81. That is why 8081 was withdrawn.

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
