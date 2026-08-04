# Release catalog

The desktop Settings → Releases panel reads a versioned JSON catalog from a
configurable HTTPS endpoint or local file. The default source is
`https://raw.githubusercontent.com/heyglassy/t3code/main/release-catalog.json`,
which is intended to be generated and published by the Glassycode release
workflow.

Each entry is anchored by an immutable commit SHA and may include PR, branch,
build, update, platform, architecture, and runtime metadata. The desktop app
persists the selected entry separately from the mutable Stable/Candidate update
channel and reports that a restart/update is required.

Milestone 1 records the user's target and emits it through the desktop IPC
bridge. The existing Electron updater still follows its configured channel;
historical target installation needs a version-addressable feed integration
(and compatibility/rollback policy) before the selection can install an
arbitrary older binary.
