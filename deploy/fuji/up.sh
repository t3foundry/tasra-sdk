#!/usr/bin/env bash
# Run the documentation site on web-server.
#
#   ./up.sh sync      copy compose.yaml to the host (no secrets exist to render)
#   ./up.sh config    validate the compose file on the host, change nothing
#   ./up.sh start     up -d
#   ./up.sh restart   up -d --force-recreate   (the ONLY way a newly loaded image takes effect)
#   ./up.sh stop      stop the container
#   ./up.sh down      remove the container   ⚠ safe here — see below
#   ./up.sh status    container state + health + what the public origin answers
#   ./up.sh logs      tail
#
# ⚠⚠ `docker restart` RE-READS NOTHING. It does not load a newly imported image — the container
#    keeps the image id it was created with, so the site silently stays on the previous build.
#    --force-recreate is the fix, which is why plain `restart` maps to it here.
#
# Unlike the vault and health stacks, `down` is offered: this project has no volume and no
# generated secret. The image contains the entire site, so the worst case is a rebuild.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cfg="$here/deployment.json"
cmd="${1:-status}"
command -v jq >/dev/null || { echo "up: jq required" >&2; exit 1; }

SSH_ALIAS="$(jq -r .host.ssh "$cfg")"
WORKDIR="$(jq -r .host.workdir "$cfg")"
PROJECT="$(jq -r .service.project "$cfg")"
CONTAINER="$(jq -r .service.container "$cfg")"
FQDN="$(jq -r .service.dns "$cfg").$(jq -r '.operator + "." + .domain' "$cfg")"
# The container port the proxy must forward to. Nothing is published to the host, so there is no
# second number to keep in step.
PORT="$(jq -r .service.port "$cfg")"

# See build.sh for why the docker invocation is resolved on the host rather than assumed.
REMOTE_DOCKER='if docker ps >/dev/null 2>&1; then D=docker; DC="docker compose"; elif sudo -n docker ps >/dev/null 2>&1; then D="sudo -n docker"; DC="sudo -n docker compose"; else echo "no docker access" >&2; exit 1; fi'

remote() { ssh -o BatchMode=yes "$SSH_ALIAS" "$REMOTE_DOCKER; $*"; }
compose() { remote "cd '$WORKDIR' && \$DC -p '$PROJECT' $*"; }

case "$cmd" in
  sync)
    # ⚠ /srv is root-owned, so a plain `mkdir -p` fails with "Permission denied" and every later
    #   copy fails after it. Bootstrap the workdir root ONCE with sudo and hand it to the ssh user;
    #   everything below then needs none. Same idiom as the vault and health stacks.
    ssh -o BatchMode=yes "$SSH_ALIAS" "test -d '$WORKDIR' || sudo -n install -d -o \"\$(id -un)\" -g \"\$(id -gn)\" -m 755 '$WORKDIR'"
    scp -q -o BatchMode=yes "$here/compose.yaml" "$SSH_ALIAS:$WORKDIR/compose.yaml"
    echo "  sent  compose.yaml → $SSH_ALIAS:$WORKDIR/"
    ;;
  config)  compose config >/dev/null && echo "  compose file is valid on $SSH_ALIAS" ;;
  start)   compose up -d ;;
  restart) compose up -d --force-recreate ;;
  stop)    compose stop ;;
  down)    compose down ;;
  status)
    remote "\$D ps --filter name=$CONTAINER --format '  {{.Names}}  {{.Image}}  {{.Status}}'" || true
    printf '  image  %s\n' "$(remote "\$D inspect $CONTAINER --format '{{.Image}}'" 2>/dev/null || echo '— not created')"
    # ⚠⚠ PROBE THE PATH THE PROXY ACTUALLY USES, from inside the proxy. Nothing is published to
    #    the host, so there is no endpoint to curl from here — and this is the one check that
    #    separates "the site is broken" from "the proxy host is misconfigured or DNS is missing".
    #    It is what proved an NPM host forwarding to :8081 was the cause of a 502 while the
    #    container was serving perfectly on :80.
    printf '  upstream %s  (tasra-sdk-docs:%s, as NPM reaches it)\n' \
      "$(remote "\$D exec traefik-app-1 curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://$CONTAINER:$PORT/" 2>/dev/null || echo unreachable)" "$PORT"
    printf '  https    %s  (https://%s/ — needs the NPM host AND the DNS record)\n' \
      "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$FQDN/" 2>/dev/null || echo unreachable)" "$FQDN"
    # ⚠ A 200 on / proves nginx and the pages. It does NOT prove search: pagefind is fetched by JS
    #   and a missing index returns nothing for every query without any page looking broken.
    printf '  search   %s\n' "$(remote "\$D exec traefik-app-1 curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://$CONTAINER:$PORT/pagefind/pagefind.js" 2>/dev/null || echo unreachable)"
    # Reported, not probed: the record was removed on purpose, so this only checks it stayed removed.
    # ⚠⚠ ASK THE AUTHORITATIVE NAMESERVER, NOT THE LOCAL RESOLVER. A plain `dig` returns this
    #    machine's cache, which holds the record for up to its old TTL after deletion — so status
    #    reported the name as live for minutes after Cloudflare had stopped answering for it. Same
    #    stance as ingress.sh's `ssl` guard, which hits the opposite version of this (a cached
    #    NXDOMAIN outliving a record that now exists).
    # ⚠ Substitute with parameter expansion, NOT `sed 's/^$/…/'`. dig prints NOTHING for a name that
    #   does not resolve, and sed cannot match a line that was never emitted — so the sed form
    #   printed a blank field, which reads as "the check did not run" rather than "no record".
    _ns="$(dig +short NS "$(jq -r .domain "$cfg" | sed 's/^.*\.\([^.]*\.[^.]*\)$/\1/')" 2>/dev/null | head -1)"
    _a="$(dig +short ${_ns:+@$_ns} "$FQDN" A 2>/dev/null | head -1)"
    printf '  dns      %s\n' "${_a:-none at the authoritative NS — run ./ingress.sh dns}"
    ;;
  logs)    remote "\$D logs --tail 80 -f $CONTAINER" ;;
  *) echo "usage: up.sh <sync|config|start|restart|stop|down|status|logs>" >&2; exit 1 ;;
esac
