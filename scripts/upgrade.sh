#!/usr/bin/env bash
set -euo pipefail

REPO="${GITHUB_REPO:-}"
BASE_DIR="${OPSVAULT_BASE_DIR:-/opt/opsvault}"
RESTART_CMD="${OPSVAULT_RESTART_CMD:-}"
VERSION=""
DRY_RUN=false
ARTIFACT=""
CHECKSUM=""
CHECKSUM_FILE=""

usage() {
  cat <<'EOF'
用法：upgrade.sh [选项]

  --version <vX.Y.Z>   目标版本（v 前缀可省略）
  --dry-run            仅下载并校验 SHA256，不切换
  --artifact <path>    使用本地归档（离线/演练）
  --checksum <sha256>  直接提供归档 SHA256
  --checksum-file <p>  SHA256SUMS 文件路径
  --repo owner/name    GitHub 仓库（默认读 GITHUB_REPO）
  --dir <path>         部署根目录（默认 /opt/opsvault）
  --restart-cmd <cmd>  升级后重启命令（默认 OPSVAULT_RESTART_CMD）

示例：
  upgrade.sh --version v0.2.0 --dry-run
  upgrade.sh --version v0.2.0 --restart-cmd 'systemctl restart opsvault'
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2#v}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --artifact) ARTIFACT="$2"; shift 2 ;;
    --checksum) CHECKSUM="$2"; shift 2 ;;
    --checksum-file) CHECKSUM_FILE="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --dir) BASE_DIR="$2"; shift 2 ;;
    --restart-cmd) RESTART_CMD="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "${VERSION}" && -z "${ARTIFACT}" ]]; then
  echo "需要 --version 或 --artifact" >&2
  exit 2
fi

TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TMPDIR}"' EXIT

if [[ -n "${ARTIFACT}" ]]; then
  ARCHIVE="${ARTIFACT}"
else
  if [[ -z "${REPO}" ]]; then
    echo "需要 --repo 或 GITHUB_REPO（例如 owner/opsvault）" >&2
    exit 2
  fi
  ARCHIVE="${TMPDIR}/opsvault-${VERSION}.tar.gz"
  URL="https://github.com/${REPO}/releases/download/v${VERSION}/opsvault-${VERSION}.tar.gz"
  echo "下载 ${URL}"
  curl -fL --retry 3 -o "${ARCHIVE}" "${URL}"
fi

if [[ -z "${CHECKSUM}" ]]; then
  if [[ -n "${CHECKSUM_FILE}" ]]; then
    CHECKSUM="$(grep " $(basename "${ARCHIVE}")$" "${CHECKSUM_FILE}" | awk '{print $1}')"
  elif [[ -n "${VERSION}" && -n "${REPO}" ]]; then
    curl -fsSL -o "${TMPDIR}/SHA256SUMS" "https://github.com/${REPO}/releases/download/v${VERSION}/SHA256SUMS"
    CHECKSUM="$(grep " $(basename "${ARCHIVE}")$" "${TMPDIR}/SHA256SUMS" | awk '{print $1}')"
  fi
fi

if [[ -z "${CHECKSUM}" ]]; then
  echo "缺少 SHA256 校验值（可用 --checksum / --checksum-file）" >&2
  exit 2
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
else
  ACTUAL="$(shasum -a 256 "${ARCHIVE}" | awk '{print $1}')"
fi

if [[ "${ACTUAL}" != "${CHECKSUM}" ]]; then
  echo "SHA256 校验失败：期望 ${CHECKSUM}，实际 ${ACTUAL}" >&2
  exit 1
fi
echo "SHA256 校验通过：${ACTUAL}"

if ${DRY_RUN}; then
  echo "dry-run：校验完成，未做任何变更。"
  exit 0
fi

if [[ -z "${VERSION}" ]]; then
  echo "非 dry-run 模式需要 --version" >&2
  exit 2
fi

mkdir -p "${BASE_DIR}/releases"
NEW_DIR="${BASE_DIR}/releases/${VERSION}"
if [[ -e "${NEW_DIR}" ]]; then
  echo "目标目录已存在：${NEW_DIR}" >&2
  exit 2
fi
mkdir -p "${NEW_DIR}"
tar -xzf "${ARCHIVE}" -C "${NEW_DIR}" --strip-components=0 2>/dev/null || tar -xzf "${ARCHIVE}" -C "${NEW_DIR}"

if [[ -f "${BASE_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${BASE_DIR}/.env"
  set +a
fi
DATA_DIR="${DATA_DIR:-${BASE_DIR}/data}"
case "${DATA_DIR}" in
  /*) ;;
  *) DATA_DIR="${BASE_DIR}/${DATA_DIR#./}" ;;
esac
export DATA_DIR

if [[ -f "${NEW_DIR}/package.json" ]]; then
  if command -v pnpm >/dev/null 2>&1; then
    if [[ ! -f "${NEW_DIR}/apps/server/dist/main.js" ]]; then
      echo "归档不含构建产物，安装全部依赖并构建…"
      (cd "${NEW_DIR}" && pnpm install --frozen-lockfile && \
        pnpm --filter @opsvault/shared build && \
        pnpm --filter @opsvault/server build && \
        pnpm --filter @opsvault/web build) || {
        echo "依赖安装或构建失败，回滚" >&2
        rm -rf "${NEW_DIR}"
        exit 1
      }
    else
      echo "安装依赖（生产）…"
      (cd "${NEW_DIR}" && pnpm install --frozen-lockfile --prod) || {
        echo "依赖安装失败，回滚" >&2
        rm -rf "${NEW_DIR}"
        exit 1
      }
    fi
  else
    echo "未找到 pnpm；如归档已包含构建产物可忽略，否则请安装 pnpm" >&2
  fi
  if [[ -f "${NEW_DIR}/apps/server/dist/cli/migrate.js" ]]; then
    echo "执行数据库迁移（DATA_DIR=${DATA_DIR}）…"
    (cd "${NEW_DIR}" && DATA_DIR="${DATA_DIR}" node apps/server/dist/cli/migrate.js) || {
      echo "迁移失败，回滚" >&2
      rm -rf "${NEW_DIR}"
      exit 1
    }
  fi
fi

PREV=""
if [[ -L "${BASE_DIR}/current" ]]; then
  PREV="$(readlink "${BASE_DIR}/current")"
fi
PREV_VERSION="unknown"
if [[ -n "${PREV}" ]]; then
  PREV_VERSION="$(basename "${PREV}")"
  PREV_VERSION="${PREV_VERSION#v}"
fi

record_upgrade() {
  local status="$1"
  local cli="${NEW_DIR}/apps/server/dist/cli/index.js"
  if [[ -f "${cli}" ]]; then
    (cd "${NEW_DIR}" && DATA_DIR="${DATA_DIR}" node "${cli}" record-upgrade \
      --from "${PREV_VERSION}" --to "${VERSION}" --status "${status}") || \
      echo "警告：写入升级审计失败（服务仍已切换）" >&2
  fi
}

ln -sfn "${NEW_DIR}" "${BASE_DIR}/current.new"
mv -Tf "${BASE_DIR}/current.new" "${BASE_DIR}/current" 2>/dev/null || mv -f "${BASE_DIR}/current.new" "${BASE_DIR}/current"
echo "已切换 current → ${NEW_DIR}"

if [[ -n "${RESTART_CMD}" ]]; then
  echo "重启：${RESTART_CMD}"
  if ! bash -c "${RESTART_CMD}"; then
    echo "重启失败，回滚到 ${PREV}" >&2
    record_upgrade failed
    if [[ -n "${PREV}" ]]; then
      ln -sfn "${PREV}" "${BASE_DIR}/current"
    fi
    exit 1
  fi
fi

record_upgrade success
echo "升级完成：${VERSION}"
echo "注意：若需回滚代码，请恢复 current symlink；数据库 schema 回滚需从备份恢复。"
