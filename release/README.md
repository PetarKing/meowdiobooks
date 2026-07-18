# Shared release assets

Maintainers attach the Python wheel from `release/python` and the tarball produced by
`npm pack ./frontend` to one immutable GitHub Release. Consumers pin the tag, commit, filenames, and
SHA-256 digests; neither asset is intended for a public package registry.

Build both assets and their checksum manifest with:

```bash
scripts/build_shared_release.sh
```

The workflow wheel intentionally excludes the Apple-only MLX dependency. It contains the public
workflow contracts and reference implementation; a hosted composition must replace local MLX and
llama.cpp handlers before executing them on Linux.
