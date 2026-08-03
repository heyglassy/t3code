# Patchbot

Patchbot stores long-lived fork customizations as intent-bearing manifests instead of asking a branch to survive forever. It keeps the original diff as reference material and reapplies that change to a fresh `main` checkout every day.

## Layout

```text
tools/patchbot/
  patchbot.ts
  patches/
    compact-sidebar/
      Patch.md
      history/
        8d3817674abc-a1b2c3d4e5f6.patch
```

`patches/` is intentionally empty in this repository. Add one directory per customization and commit the manifest and its historical diffs.

## `Patch.md` format

The file begins with YAML frontmatter. `description`, `why`, and each list item may be edited as the upstream product evolves; they are the contract an agent uses when a textual patch no longer applies.

```markdown
---
name: "compact-sidebar"
description: |
  Keep the project sidebar compact on narrow screens.
why: |
  Our fork is used on small laptops and the default sidebar consumes too much space.
constraints:
  - "Do not remove keyboard navigation."
  - "Keep the mobile layout unchanged."
files_touched:
  - "apps/web/src/sidebarProjectGrouping.ts"
source_branch: "custom/compact-sidebar"
source_pr: "https://github.com/heyglassy/t3code/pull/42"
base: "main"
reference_diff: "history/8d3817674abc-a1b2c3d4e5f6.patch"
---

# Patch notes
```

`name`, `description`, `why`, and `source_branch` are required. `constraints` and `files_touched` are lists (they may be empty), `base` defaults to `main`, and `reference_diff` defaults to `history/latest.patch`. The parser also accepts the human-readable aliases `files:`, `source branch:`, and `source pr:`.

## Workflow

Capture a branch while it is checked out or reachable by name:

```sh
node --experimental-strip-types tools/patchbot/patchbot.ts capture custom/compact-sidebar \
  --name compact-sidebar \
  --description "Keep the project sidebar compact on narrow screens." \
  --why "Small-laptop users need more room for the editor." \
  --source-pr https://github.com/heyglassy/t3code/pull/42
```

On a checkout based on the current upstream main, apply one patch or all patches:

```sh
node --experimental-strip-types tools/patchbot/patchbot.ts apply compact-sidebar
node --experimental-strip-types tools/patchbot/patchbot.ts apply --all
node --experimental-strip-types tools/patchbot/patchbot.ts status
```

Patchbot first checks and applies the historical diff with Git's three-way machinery. If it no longer applies, it invokes `codex exec --full-auto` with the manifest, constraints, and diff path. The agent is asked to modify the current checkout without committing; the caller should run tests and review the resulting diff before committing.

`status` never invokes an agent. It reports `clean` when Git can apply a patch and `agent` when human/agent reapplication is needed (and exits non-zero if any patch is not clean).

## Daily automation

[`patchbot-daily.yml.example`](./patchbot-daily.yml.example) is a disabled-by-convention GitHub Actions sample. Copy it to `.github/workflows/patchbot-daily.yml` after reviewing the permissions, branch policy, and whether unattended agent execution is appropriate. It fetches `origin/main`, runs `apply --all` on a disposable branch, and creates or updates a pull request containing the regenerated fork state.
