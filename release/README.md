# Shared release assets

Maintainers attach the Python wheel from `release/python` and the tarball produced by
`npm pack ./frontend` to one immutable GitHub Release. Consumers pin the tag, commit, filenames, and
SHA-256 digests; neither asset is intended for a public package registry.

Build both assets and their checksum manifest with:

```bash
scripts/build_shared_release.sh
```

The builder requires the Python package, UI package, and UI lockfile versions to match. It stages
the new artifacts before replacing generated release files, removes older generated wheels and UI
tarballs by their resolved paths, verifies the checksums, and fails if any unexpected file remains.
After a successful build, `dist/release` contains exactly:

- the current-version Python wheel;
- the current-version UI tarball;
- `SHA256SUMS`; and
- the tracked `.gitignore`.

Do not hand-maintain generated archives in `dist/release`; rerun the builder instead.

The workflow wheel intentionally excludes the Apple-only MLX dependency. It contains the public
workflow contracts and reference implementation. Integrators targeting other platforms must provide
compatible execution adapters for the local MLX and llama.cpp handlers.
