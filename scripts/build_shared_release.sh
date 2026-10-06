#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
release_dir="${repo_root}/dist/release"
python_version="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "${repo_root}/release/python/pyproject.toml" | head -n 1)"
ui_version="$(node -p "require('${repo_root}/frontend/package.json').version")"
lock_version="$(node -p "require('${repo_root}/frontend/package-lock.json').version")"

mkdir -p "${release_dir}"
if [[ ! -f "${release_dir}/.gitignore" ]]; then
  echo "Release directory is missing its tracked .gitignore" >&2
  exit 1
fi
if [[ -z "${python_version}" || "${python_version}" != "${ui_version}" || "${ui_version}" != "${lock_version}" ]]; then
  echo "Release versions are not aligned: Python=${python_version:-missing}, UI=${ui_version:-missing}, lock=${lock_version:-missing}" >&2
  exit 1
fi

staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/meowdiobooks-release.XXXXXX")"
trap 'rm -rf -- "${staging_dir}"' EXIT

wheel_name="meowdiobooks_workflow-${python_version}-py3-none-any.whl"
ui_name="meowdiobooks-workflow-ui-${ui_version}.tgz"

for package_license in "${repo_root}/frontend/LICENSE" "${repo_root}/release/python/LICENSE"; do
  if ! cmp -s "${repo_root}/LICENSE" "${package_license}"; then
    echo "Package license must match the canonical root LICENSE: ${package_license}" >&2
    exit 1
  fi
done

uv build --wheel --out-dir "${staging_dir}" "${repo_root}/release/python"
npm pack "${repo_root}/frontend" --pack-destination "${staging_dir}" --cache "${repo_root}/.npm-cache"

if [[ ! -f "${staging_dir}/${wheel_name}" || ! -f "${staging_dir}/${ui_name}" ]]; then
  echo "Release build did not produce the expected ${python_version} assets" >&2
  exit 1
fi

(
  cd "${staging_dir}"
  shasum -a 256 "${wheel_name}" "${ui_name}" > SHA256SUMS
)

# Resolve each generated path before removal. Never pass an unresolved glob to rm.
while IFS= read -r artifact; do
  artifact_name="${artifact##*/}"
  case "${artifact_name}" in
    meowdiobooks_workflow-*.whl|meowdiobooks-workflow-ui-*.tgz|SHA256SUMS)
      rm -f -- "${artifact}"
      ;;
  esac
done < <(find "${release_dir}" -maxdepth 1 -type f -print)

mv -- "${staging_dir}/${wheel_name}" "${release_dir}/${wheel_name}"
mv -- "${staging_dir}/${ui_name}" "${release_dir}/${ui_name}"
mv -- "${staging_dir}/SHA256SUMS" "${release_dir}/SHA256SUMS"

while IFS= read -r artifact; do
  artifact_name="${artifact##*/}"
  case "${artifact_name}" in
    .gitignore|SHA256SUMS|"${wheel_name}"|"${ui_name}") ;;
    *)
      echo "Unexpected release file remains: ${artifact_name}" >&2
      exit 1
      ;;
  esac
done < <(find "${release_dir}" -maxdepth 1 -type f -print)

(
  cd "${release_dir}"
  shasum -a 256 -c SHA256SUMS
)

echo "Built shared release assets in ${release_dir}"
