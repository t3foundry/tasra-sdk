#!/usr/bin/env bash
# Public name for the documentation: the Cloudflare A record and the Nginx Proxy Manager host + cert.
#
#   ./ingress.sh plan     what would be created — no credentials used
#   ./ingress.sh dns      create the A record (Cloudflare)
#   ./ingress.sh host     create the NPM proxy host (http only)
#   ./ingress.sh ssl      request the Let's Encrypt certificate and force https
#   ./ingress.sh status   what exists now
#
# ⚠⚠ ONE NGINX SERVES ~35 UNRELATED PRODUCTION SITES. Every write here is additive and refuses to
#    modify a host it did not create. There is no bulk verb, deliberately.
#
# ⚠⚠ PROXIED IS FALSE. Let's Encrypt HTTP-01 must be answered by NPM at the origin; an
#    orange-clouded record has Cloudflare answer it instead and issuance fails. And this name is
#    THREE labels below the apex (sdk.t3-foundry.fuji.tasra.network), which Cloudflare's Universal
#    SSL does not cover — so proxying would not even supply a certificate in exchange.
#
# Credentials come from the environment, else the macOS keychain. ⚠ They are TOOLING credentials
# and never belong in this repository.
#   CF_API_TOKEN           — Zone → DNS → Edit on tasra.network ONLY (never a Global API Key)
#   NPM_EMAIL/NPM_PASSWORD — the proxy manager console
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cfg="$here/deployment.json"
cmd="${1:-plan}"
command -v jq >/dev/null || { echo "ingress: jq required" >&2; exit 1; }

DOMAIN="$(jq -r '.operator + "." + .domain' "$cfg")"
FQDN="$(jq -r .service.dns "$cfg").$DOMAIN"
ZONE="$(jq -r .domain "$cfg" | sed 's/^.*\.\([^.]*\.[^.]*\)$/\1/')"      # fuji.tasra.network → tasra.network
IP="$(jq -r .ingress.ip "$cfg")"
CONTAINER="$(jq -r .service.container "$cfg")"
PORT="$(jq -r .service.port "$cfg")"
NICE="tasra-sdk-docs"
TMP="/tmp/tasra-sdk-docs-npm.json"

kc() { security find-generic-password -a "$2" -s "$1" -w 2>/dev/null; }

# ── Cloudflare ───────────────────────────────────────────────────────────────────────────────
cf_token() {
  [ -n "${CF_API_TOKEN:-}" ] && { printf '%s' "$CF_API_TOKEN"; return; }
  kc cf-dns-token cloudflare-tasra ||
    { echo "ingress: no Cloudflare token — set CF_API_TOKEN, or add it to the keychain:" >&2
      echo "  security add-generic-password -a cloudflare-tasra -s cf-dns-token -w" >&2; exit 1; }
}
cf() { # method path [body]
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -sS -X "$m" "https://api.cloudflare.com/client/v4$p" -H "authorization: Bearer $(cf_token)" \
      -H 'content-type: application/json' --data "$b"
  else
    curl -sS -X "$m" "https://api.cloudflare.com/client/v4$p" -H "authorization: Bearer $(cf_token)"
  fi
}
zone_id() {
  local r; r="$(cf GET "/zones?name=$ZONE")"
  jq -er '.result[0].id' <<<"$r" 2>/dev/null ||
    { echo "ingress: cannot read zone $ZONE — $(jq -r '.errors[0].message // "unknown error"' <<<"$r")" >&2; exit 1; }
}

# ── Nginx Proxy Manager ──────────────────────────────────────────────────────────────────────
npm_token() {
  NPM_URL="${NPM_URL:-$(jq -r .ingress.admin_url "$cfg")}"
  NPM_EMAIL="${NPM_EMAIL:-$(kc kk-fuji-npm-email npm-managination || true)}"
  NPM_PASSWORD="${NPM_PASSWORD:-$(kc kk-fuji-npm-password npm-managination || true)}"
  [ -n "$NPM_EMAIL" ] && [ -n "$NPM_PASSWORD" ] ||
    { echo "ingress: no NPM credentials — export NPM_EMAIL/NPM_PASSWORD or store them in the keychain" >&2; exit 1; }
  curl -fsS -X POST "$NPM_URL/api/tokens" -H 'content-type: application/json' \
    -d "$(jq -n --arg i "$NPM_EMAIL" --arg s "$NPM_PASSWORD" '{identity:$i,secret:$s}')" | jq -er .token
}
post_json() { # url token body  → prints http code, body in $TMP
  curl -sS -o "$TMP" -w '%{http_code}' -X POST "$1" \
    -H "authorization: Bearer $2" -H 'content-type: application/json' --data-binary "$3"
}

advanced() {
cat <<'ADV'
# A static documentation site needs nothing special from the proxy — the origin's nginx.conf owns
# MIME types, cache headers and the 404 page.
#
# ⚠⚠ DO NOT SET caching_enabled ON THIS HOST. NPM's cache would sit in front of an origin that
#    already answers `immutable` for /_astro/* (content-hashed, safe forever) and
#    `must-revalidate` for HTML (never content-hashed). Caching at the proxy flattens that
#    distinction and pins index.html to hashed assets a later deploy has already deleted — the
#    page renders unstyled and a rebuild does not fix it.
#
# The site accepts no input, so the body limit is small on purpose.
client_max_body_size 1m;
ADV
}

host_payload() {
  jq -n --arg d "$FQDN" --arg h "$CONTAINER" --argjson p "$PORT" --arg adv "$(advanced)" '{
    domain_names: [$d],
    forward_scheme: "http",
    # ⚠ The CONTAINER NAME, not an IP. NPM shares the `proxy` network with this stack and reaches
    #   it by name; 127.0.0.1 would be the NPM container itself, and the host IP would mean
    #   publishing the site to the internet on plain http.
    forward_host: $h,
    forward_port: $p,
    certificate_id: 0,
    ssl_forced: false,
    http2_support: true,
    hsts_enabled: false,
    block_exploits: true,
    caching_enabled: false,
    allow_websocket_upgrade: false,
    access_list_id: 0,
    advanced_config: $adv,
    enabled: true,
    meta: {}
  }'
}

case "$cmd" in
  plan)
    echo "  name:     $FQDN"
    echo "  zone:     $ZONE          A → $IP   (proxied=false, DNS only)"
    echo "  upstream: $CONTAINER:$PORT   on the '$(jq -r .ingress.proxy_network "$cfg")' network"
    echo
    echo "  order: dns → (dig confirms) → host → ssl"
    echo "  ⚠ ssl before DNS resolves burns a Let's Encrypt attempt against the weekly limit."
    ;;

  dns)
    zid="$(zone_id)"
    cur="$(cf GET "/zones/$zid/dns_records?type=A&name=$FQDN")"
    if [ "$(jq -r '.result | length' <<<"$cur")" != 0 ]; then
      ip="$(jq -r '.result[0].content' <<<"$cur")"; px="$(jq -r '.result[0].proxied' <<<"$cur")"
      if [ "$ip" = "$IP" ] && [ "$px" = "false" ]; then echo "  have  $FQDN → $ip (DNS only)"
      else echo "  ⚠ WRONG $FQDN → $ip proxied=$px — fix or delete it in the dashboard; this script will not modify a record it did not create" >&2; exit 1; fi
      exit 0
    fi
    r="$(cf POST "/zones/$zid/dns_records" "$(jq -n --arg n "$FQDN" --arg c "$IP" '{type:"A",name:$n,content:$c,ttl:1,proxied:false}')")"
    jq -e .success >/dev/null <<<"$r" && echo "  create $FQDN → $IP (DNS only)" \
      || { echo "  FAILED $FQDN: $(jq -r '.errors[0].message' <<<"$r")" >&2; exit 1; }
    ;;

  host)
    t="$(npm_token)"
    if curl -fsS "$NPM_URL/api/nginx/proxy-hosts" -H "authorization: Bearer $t" |
       jq -e --arg d "$FQDN" 'any(.[].domain_names[]; . == $d)' >/dev/null; then
      echo "  skip  $FQDN (already present — never modified by this script)"; exit 0
    fi
    code="$(post_json "$NPM_URL/api/nginx/proxy-hosts" "$t" "$(host_payload)")"
    case "$code" in
      200|201) echo "  create $FQDN → $CONTAINER:$PORT   (http only; now: ./ingress.sh ssl)" ;;
      *) echo "  FAILED $FQDN (http $code)" >&2; head -c 800 "$TMP" >&2; echo >&2
         echo "  stopping — one nginx serves 35 other sites." >&2; exit 1 ;;
    esac
    ;;

  ssl)
    # ⚠⚠ ASK AN AUTHORITATIVE NAMESERVER, NOT THE LOCAL RESOLVER. A plain `dig` uses whatever this
    #    machine resolves with, and that cache holds a NEGATIVE entry for any name looked up BEFORE
    #    the record was created — which is exactly what happens here, because `plan` and `dns` both
    #    query the name first. The stale NXDOMAIN outlives the record by up to the zone's negative
    #    TTL, so this guard would refuse a name every resolver on the internet already answers.
    _ns="$(dig +short NS "$ZONE" 2>/dev/null | head -1)"
    resolved="$(dig +short ${_ns:+@$_ns} "$FQDN" A 2>/dev/null | head -1)"
    [ -n "$resolved" ] || resolved="$(dig +short @1.1.1.1 "$FQDN" A 2>/dev/null | head -1)"
    if [ -z "$resolved" ]; then
      echo "ingress: $FQDN does not resolve at the authoritative nameserver either — Let's Encrypt would fail and burn an attempt" >&2
      exit 1
    fi
    if [ -z "$(dig +short "$FQDN" A 2>/dev/null | head -1)" ]; then
      echo "  note: $FQDN resolves at $_ns but NOT on this machine — a stale negative cache."
      echo "        Harmless here (Let's Encrypt resolves it from the internet), but flush it before"
      echo "        testing by name:  sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder"
    fi
    t="$(npm_token)"
    id="$(curl -fsS "$NPM_URL/api/nginx/proxy-hosts" -H "authorization: Bearer $t" |
          jq -r --arg d "$FQDN" '.[] | select(.domain_names | index($d)) | .id')"
    [ -n "$id" ] || { echo "ingress: no proxy host for $FQDN — run ./ingress.sh host first" >&2; exit 1; }
    # ⚠⚠ meta CARRIES EXACTLY ONE KEY HERE. NPM 2.15's certificate schema declares meta with
    #    additionalProperties:false and only eight permitted keys; `letsencrypt_email` and
    #    `letsencrypt_agree` — which every guide still shows — are NOT among them. Sending them
    #    returns 400 "data/meta must NOT have additional properties" REPEATED ONCE PER OFFENDING
    #    KEY and naming none of them, which reads like one malformed field rather than two rejected
    #    ones. The ACME account belongs to the NPM instance, not to this payload.
    #    dns_challenge:false selects HTTP-01, which is why the A record above must be grey-cloud.
    code="$(post_json "$NPM_URL/api/nginx/certificates" "$t" \
      "$(jq -n --arg d "$FQDN" --arg n "$NICE" '{domain_names:[$d], meta:{dns_challenge:false}, nice_name:$n, provider:"letsencrypt"}')")"
    case "$code" in
      200|201)
        cid="$(jq -r .id "$TMP")"
        curl -sS -o /dev/null -X PUT "$NPM_URL/api/nginx/proxy-hosts/$id" \
          -H "authorization: Bearer $t" -H 'content-type: application/json' \
          --data-binary "$(jq -n --argjson c "$cid" '{certificate_id:$c, ssl_forced:true, http2_support:true}')"
        echo "  ssl   $FQDN (cert $cid, resolves to $resolved)" ;;
      *) echo "  FAILED $FQDN cert (http $code)" >&2; head -c 800 "$TMP" >&2; echo >&2; exit 1 ;;
    esac
    ;;

  status)
    printf '  dns    %s\n' "$(dig +short "$FQDN" A | head -1 | sed 's/^$/— does not resolve/')"
    printf '  https  %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$FQDN/" 2>/dev/null || echo unreachable)"
    printf '  search %s\n' "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$FQDN/pagefind/pagefind.js" 2>/dev/null || echo unreachable)"
    ;;

  *) echo "usage: ingress.sh <plan|dns|host|ssl|status>" >&2; exit 1 ;;
esac
