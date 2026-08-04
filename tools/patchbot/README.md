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

[`.github/workflows/patchbot-daily.yml`](../../.github/workflows/patchbot-daily.yml) runs every day at 09:17 UTC and can also be started with **Run workflow**. It fetches `origin/main`, runs `apply --all` on the disposable `patchbot/daily` branch, and creates or updates a pull request containing the regenerated fork state. Runs are serialized so a manual run cannot overlap the scheduled run.

Before the first run, add a repository Actions secret with this exact name:

```text
CODEX_AUTH_JSON
```

Set its value to the contents of the Codex CLI authentication file (`~/.codex/auth.json`) for the account Patchbot should use. Keep the file contents in GitHub Secrets; do not commit them or put them in workflow YAML. The workflow stops immediately with an error if `CODEX_AUTH_JSON` is missing, then writes it to the runner's temporary Codex home before invoking the fallback agent. The workflow also needs permission to write contents and pull requests, as declared in the workflow.

The required activation follow-up for a repository administrator is: add `CODEX_AUTH_JSON` under **Settings → Secrets and variables → Actions → New repository secret**, then run the workflow manually once and review the generated pull request.

[`patchbot-daily.yml.example`](./patchbot-daily.yml.example) remains a reference copy for forks that want to adapt the automation instead of using the shipped workflow.
