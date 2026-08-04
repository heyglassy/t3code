# Release catalog

The desktop Settings → Releases panel reads a versioned JSON catalog from a
configurable HTTPS endpoint or local file. The default source is
`https://raw.githubusercontent.com/heyglassy/t3code/main/release-catalog.json`,
which is intended to be generated and published by the Glassycode release
workflow.

The workflow updates the catalog only after a successful `build` release. It
maps the workflow's `production` channel to catalog `stable` and `candidate`
to catalog `nightly`, then runs:

```bash
node scripts/update-release-catalog.ts \
  --version <version> \
  --commit-sha <build-commit> \
  --channel <stable|nightly> \
  --build-id <build-id> \
  --update-id <update-id> \
  --platform desktop \
  --architecture arm64 \
  --branch <source-branch> \
  --generated-at <utc-timestamp>
```

The script decodes the existing document and the resulting document with
`ReleaseCatalogSchema`, derives an ID from channel/version/commit, replaces an
existing entry with the same ID, sorts entries newest-first, and writes the
injected `generatedAt` timestamp. The workflow then commits the catalog to
`main`. It fetches and resets to the latest `main` before each attempt and
retries a failed push five times, so concurrent release jobs preserve each
other's entries. A `promote` action does not add a catalog entry because it
only changes the mutable update-channel pointer.

Each entry is anchored by an immutable commit SHA and may include PR, branch,
build, update, platform, architecture, and runtime metadata. Desktop entries
published by the workflow include `schemaVersion: 1` and `architecture: arm64`.
The schema version is the desktop data-compatibility version, not the catalog
document version. Entries without it are treated as legacy version 1 metadata.

## Milestone 2 semantics

Selecting a compatible desktop entry now configures `electron-updater` with a
generic, immutable feed at:

```text
<DESKTOP_UPDATE_BASE_URL>/releases/<version>/
```

The release workflow archives the matching `latest-mac.yml` or
`nightly-mac.yml` manifest and its referenced artifacts at that location. An entry may provide
`updateFeedUrl` to override the derived URL for a self-hosted catalog. The
updater sets the manifest channel from the entry (`stable` uses `latest`, while
`candidate`/`nightly` use `nightly`) and enables downgrade checks for an exact
selection. The selected version is checked and downloaded automatically; the
existing update IPC state reports checking, download progress, ready-to-restart,
and failure states. On restart, the persisted selection restores the same feed.

The downloaded updater event must report the selected version. If the updater
provides commit metadata, it must also match the catalog `commitSha`; current
electron-builder manifests expose version but not commit metadata, so commit
verification is conditional. The embedded app commit is still available in the
installed package for post-restart diagnostics.

“Follow channel” clears the persisted target, restores the normal configured
Stable/Candidate feed, and resumes mutable channel updates.

The desktop refuses entries whose platform is not `desktop`/`all`, whose
architecture does not match the running app, or whose data `schemaVersion` is
unsupported. A downgrade across a data migration is therefore not silently
allowed: users must first run a newer app that knows how to migrate or otherwise
export/restore their data, then select the older release only when its catalog
compatibility metadata matches. A failed download or verification leaves the
current app installed and exposes a failure; users can retry after refreshing
the catalog or use “Follow channel” to return to the normal update path.
