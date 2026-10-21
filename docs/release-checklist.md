# Release Checklist

Use this checklist before publishing a new version of Bilibili Subtitle Vocabulary.

1. Update the version in both:
   - `bilibili-vocab-extension/manifest.json`
   - `bilibili-vocab-extension/package.json`
2. Update `CHANGELOG.md` with a new section for the version (follow [Semantic Versioning](https://semver.org/lang/zh-CN/)).
3. From `bilibili-vocab-extension`, run the release candidate gate:
   - `pnpm run release:check`
   - This includes lint, typecheck, unit tests, UI tests, extension build, browser smoke, pack, package policy check, and zip smoke.
4. Optional real-site gate when needed:
   - `pnpm run release:check:real-site`
5. Confirm the upload artifact is only the zip produced by the current `pnpm run pack` / release check run (`extension.zip`). Do not reuse historical `v0.1.x` zip files from the working tree.
6. Update store screenshots and descriptions if the UI changed in this release.
7. Create a git tag `vX.Y.Z` and push it.
8. Create a GitHub Release, attach the current pack zip, and paste the changelog notes.
