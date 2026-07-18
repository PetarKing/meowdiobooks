#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
release_dir="${repo_root}/dist/release"

mkdir -p "${release_dir}"
uv build --wheel --out-dir "${release_dir}" "${repo_root}/release/python"
npm pack "${repo_root}/frontend" --pack-destination "${release_dir}" --cache "${repo_root}/.npm-cache"
(
  cd "${release_dir}"
  shasum -a 256 meowdiobooks_workflow-*.whl meowdiobooks-workflow-ui-*.tgz > SHA256SUMS
)

echo "Built shared release assets in ${release_dir}"
