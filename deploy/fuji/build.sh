#!/usr/bin/env bash
# Build the documentation image on this machine and ship it to web-server.
#
#   ./build.sh site      build the image
#   ./build.sh ship      docker save | ssh web-server docker load
#   ./build.sh all       build, then ship
#
# ⚠⚠ --platform linux/amd64 IS NOT OPTIONAL ON AN APPLE-SILICON MAC. Without it buildx produces an
#    arm64 image, `docker load` on web-server accepts it without complaint, and the container dies
#    with "exec format error" — which reads like a broken entrypoint. Asserted below, not assumed.
#
# ⚠ The build context is the REPOSITORY ROOT, not site/ — see Dockerfile.docs. The context is
#   withheld by Dockerfile.docs.dockerignore; without it 909 MB of node_modules is uploaded.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cfg="$here/deployment.json"
cmd="${1:-all}"

command -v jq >/dev/null || { echo "build: jq required" >&2; exit 1; }

SSH_ALIAS="$(jq -r .host.ssh "$cfg")"
IMAGE="$(jq -r .service.image "$cfg")"
FQDN="$(jq -r .service.dns "$cfg").$(jq -r '.operator + "." + .domain' "$cfg")"

# The remote user may or may not be in the docker group; on web-server it is not. Resolve once, ON
# THE HOST, and use $D for every remote docker call.
# ⚠ A bare `docker` there fails with "permission denied while trying to connect to the docker API
#   at unix:///var/run/docker.sock", which names no fix and reads like a broken daemon rather than
#   a group membership. Hard-coding `sudo -n docker` instead breaks the opposite host.
REMOTE_DOCKER='if docker ps >/dev/null 2>&1; then D=docker; elif sudo -n docker ps >/dev/null 2>&1; then D="sudo -n docker"; else echo "no docker access (neither docker-group membership nor passwordless sudo)" >&2; exit 1; fi'

arch_check() {
  local a; a="$(docker image inspect "$1" --format '{{.Architecture}}/{{.Os}}')"
  [ "$a" = "amd64/linux" ] || { echo "build: $1 is $a, not amd64/linux — web-server cannot run it" >&2; exit 1; }
  echo "  arch  $1 = $a"
}

build_site() {
  echo "build: $IMAGE   (context: $repo)"
  docker buildx build --platform linux/amd64 \
    -f "$here/Dockerfile.docs" \
    -t "$IMAGE" --load "$repo"
  arch_check "$IMAGE"
  # ⚠ The canonical URL is baked in at BUILD TIME by astro (site/astro.config.mjs `site`). A
  #   rebuilt image does not change it, and a mismatch is invisible in the browser — it only shows
  #   in the canonical link, the sitemap and social previews. So assert it here.
  if ! docker run --rm --entrypoint sh "$IMAGE" -c "grep -qF 'https://$FQDN' /usr/share/nginx/html/index.html"; then
    echo "build: the built site does not carry https://$FQDN as its canonical origin" >&2
    echo "       set the 'site' key in site/astro.config.mjs to match deployment.json .service.dns" >&2
    exit 1
  fi
  echo "  canon $IMAGE declares https://$FQDN"
}

case "$cmd" in
  site) build_site ;;
  all)  build_site; "$0" ship ;;
  ship)
    docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "build: $IMAGE not built yet" >&2; exit 1; }
    arch_check "$IMAGE"
    echo "ship: $IMAGE → $SSH_ALIAS"
    docker save "$IMAGE" | ssh -o BatchMode=yes "$SSH_ALIAS" "$REMOTE_DOCKER; \$D load"
    ssh -o BatchMode=yes "$SSH_ALIAS" "$REMOTE_DOCKER; \$D image inspect '$IMAGE' --format '  on host: {{.Architecture}}/{{.Os}} {{.Id}}'"
    ;;
  *) echo "usage: build.sh <site|ship|all>" >&2; exit 1 ;;
esac
