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
build, update, platform, architecture, and runtime metadata. The desktop app
persists the selected entry separately from the mutable Stable/Candidate update
channel and reports that a restart/update is required.

Milestone 1 records the user's target and emits it through the desktop IPC
bridge. The existing Electron updater still follows its configured channel;
historical target installation needs a version-addressable feed integration
(and compatibility/rollback policy) before the selection can install an
arbitrary older binary.
