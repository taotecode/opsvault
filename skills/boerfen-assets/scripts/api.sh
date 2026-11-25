#!/usr/bin/env bash
set -euo pipefail

BASE="${BOERFEN_BASE_URL:-}"
TOKEN="${BOERFEN_API_TOKEN:-}"

if [[ -z "$BASE" || -z "$TOKEN" ]]; then
  echo "需要设置 BOERFEN_BASE_URL 与 BOERFEN_API_TOKEN" >&2
  exit 2
fi

BASE="${BASE%/}"
API="$BASE/api/v1"

usage() {
  cat <<'EOF'
用法：api.sh <group> <command> [args]

  hosts list [--env prod|staging|dev] [--status online|warning|offline|pending] [--q 关键字]
  hosts search <关键字>
  hosts get <id>
  hosts create <json>
  hosts update <id> <json>
  hosts probe <id>
  hosts batch-probe <id> [id...]
  keys list
  keys connect <keypairId> [hostId]
  creds list
  audit list [--category auth|asset|cred|key|api|user] [--limit 20]
  version
EOF
}

# 纯 bash percent-encode，避免依赖外部工具
urlenc() {
  local s="$1" out="" c i
  LC_ALL=C
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case "$c" in
      [A-Za-z0-9.~_-]) out+="$c" ;;
      *) printf -v c '%%%02X' "'$c"; out+="$c" ;;
    esac
  done
  printf '%s' "$out"
}

req() {
  local method="$1" url="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$body" "$url"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" "$url"
  fi
}

group="${1:-}"; shift || true
cmd="${1:-}"; shift || true

case "$group" in
  hosts)
    case "$cmd" in
      list)
        qs=""
        while [[ $# -gt 0 ]]; do
          case "$1" in
            --env) qs="${qs}&env=$(urlenc "$2")"; shift 2 ;;
            --status) qs="${qs}&status=$(urlenc "$2")"; shift 2 ;;
            --q) qs="${qs}&q=$(urlenc "$2")"; shift 2 ;;
            *) echo "未知参数：$1" >&2; exit 2 ;;
          esac
        done
        req GET "$API/hosts?limit=100${qs}"
        ;;
      search)
        if [[ $# -lt 1 ]]; then echo "缺少关键字" >&2; exit 2; fi
        req GET "$API/hosts?limit=50&q=$(urlenc "$1")"
        ;;
      get)
        if [[ $# -lt 1 ]]; then echo "缺少 id" >&2; exit 2; fi
        req GET "$API/hosts/$1"
        ;;
      create)
        if [[ $# -lt 1 ]]; then echo "缺少 JSON body" >&2; exit 2; fi
        req POST "$API/hosts" "$1"
        ;;
      update)
        if [[ $# -lt 2 ]]; then echo "用法：hosts update <id> <json>" >&2; exit 2; fi
        req PATCH "$API/hosts/$1" "$2"
        ;;
      probe)
        if [[ $# -lt 1 ]]; then echo "缺少 id" >&2; exit 2; fi
        req POST "$API/hosts/$1/probe"
        ;;
      batch-probe)
        if [[ $# -lt 1 ]]; then echo "缺少 id" >&2; exit 2; fi
        ids=""
        for id in "$@"; do ids="${ids}\"$id\","; done
        ids="${ids%,}"
        req POST "$API/hosts/batch-probe" "{\"hostIds\":[$ids]}"
        ;;
      *) usage; exit 2 ;;
    esac
    ;;
  keys)
    case "$cmd" in
      list) req GET "$API/keypairs" ;;
      connect)
        if [[ $# -lt 1 ]]; then echo "缺少 keypairId" >&2; exit 2; fi
        if [[ $# -ge 2 ]]; then
          req GET "$API/keypairs/$1/connect-command?hostId=$(urlenc "$2")"
        else
          req GET "$API/keypairs/$1/connect-command"
        fi
        ;;
      *) usage; exit 2 ;;
    esac
    ;;
  creds)
    [[ "$cmd" == "list" ]] || { usage; exit 2; }
    req GET "$API/credentials"
    ;;
  audit)
    [[ "$cmd" == "list" ]] || { usage; exit 2; }
    a_limit="20"; a_category=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --category) a_category="$2"; shift 2 ;;
        --limit) a_limit="$2"; shift 2 ;;
        *) echo "未知参数：$1" >&2; exit 2 ;;
      esac
    done
    qs="limit=$(urlenc "$a_limit")"
    if [[ -n "$a_category" ]]; then qs="${qs}&category=$(urlenc "$a_category")"; fi
    req GET "$API/audit?$qs"
    ;;
  version)
    req GET "$API/system/version"
    ;;
  *)
    usage
    exit 2
    ;;
esac
