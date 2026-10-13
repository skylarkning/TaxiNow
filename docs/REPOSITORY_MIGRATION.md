# TaxiNow repository consolidation

Migration date: October 13, 2026.

I now maintain TaxiNow Pro source code, release downloads, user documentation,
and issue tracking at [skylarkning/TaxiNow](https://github.com/skylarkning/TaxiNow).
I retain [TaxiNow-Release](https://github.com/skylarkning/TaxiNow-Release) as a
compatibility archive for existing downloads, update checks, and map-index URLs.

## What moved

- All 18 published releases and their 40 assets, including prereleases and the
  local map-pack builder installer. Asset names, bytes, and SHA-256 hashes are
  preserved. GitHub assigns new release/asset IDs and publication timestamps;
  each migrated release records its original publication date in its notes.
- Original Git tags and release-repository history. Historical release tags
  still identify release documentation, as they did in TaxiNow-Release; they
  do not reconstruct historical application source. The application source is
  maintained on the TaxiNow `main` branch.
- V2.0 English and Chinese blog posts, bilingual changelog, checksum file,
  logo, and issue forms. The unified README combines the user guide with
  download links, my first-person source/security announcement, and build
  instructions. The existing technical overview is retained in
  [DEVELOPMENT.md](DEVELOPMENT.md).
- The three historical issues, preserving their closed states and discussions.
  GitHub redirects their original URLs to the transferred issues.

| Original issue | Transferred issue |
| --- | --- |
| [TaxiNow-Release #1](https://github.com/skylarkning/TaxiNow-Release/issues/1) | [TaxiNow #24](https://github.com/skylarkning/TaxiNow/issues/24) |
| [TaxiNow-Release #2](https://github.com/skylarkning/TaxiNow-Release/issues/2) | [TaxiNow #25](https://github.com/skylarkning/TaxiNow/issues/25) |
| [TaxiNow-Release #3](https://github.com/skylarkning/TaxiNow-Release/issues/3) | [TaxiNow #26](https://github.com/skylarkning/TaxiNow/issues/26) |

The license, EULA, disclaimer, and third-party notices agree between both
repositories and are unchanged. Public source access does not expand their
reuse permissions.

## Compatibility

Existing release binaries are unchanged. Builds through 207 still query
`skylarkning/TaxiNow-Release/releases/latest` and accept that repository's
installer URLs. The old releases remain available, including the current V2.0
installer. Future source builds query `skylarkning/TaxiNow/releases/latest`.
To move an existing installation to that endpoint, install a later official
build containing these changes; copying the old installer to the new repository
does not change its behavior.

The new installer download policy accepts only HTTPS executable assets from
the unified repository or the original release repository, with the existing
SHA-256 verification still required. Other repositories, hosts, ports,
credentials, and file types are rejected.

Both map-pack indexes currently contain an empty `packs` array. No regional
pack assets need moving. Future source builds and the map-pack publication
tools default to the TaxiNow index and releases. The legacy empty index is
preserved for old clients.

## Publishing future releases

1. Increment the internal build and the matching version/installer identifiers
   before publishing a new installer. Do not overwrite the migrated Build 207
   assets with a changed executable.
2. Build, test, and package from TaxiNow, then publish the installer, portable
   ZIP, checksum file, and notes in its Releases page.
3. Update the flightsim.to listing to use the unified repository's download
   links. Its existing legacy links continue to work in the meantime.
4. If automatic updates for unconverted legacy installations are required,
   publish the first migration build in TaxiNow-Release as well, before
   archiving it. Otherwise, existing users can install the new build manually
   from TaxiNow. An archived repository continues serving old releases but
   cannot receive new releases.

I leave the compatibility repository available during this transition. Its
README directs users to TaxiNow; no original downloads are removed.

## Validation

- All migrated assets checked against the original SHA-256 digest and byte
  length before upload, and against GitHub's destination digest after upload.
- Latest stable release selected explicitly as `v2.0.0`; prerelease flags kept.
- .NET tests include unified/legacy official installer acceptance and rejection
  of untrusted URLs; web and map-pipeline suites also run for the changed
  repository defaults and public-source notices.
- Local Markdown links, unchanged legal files, transferred issue states, and
  legacy download availability checked as part of migration verification.
