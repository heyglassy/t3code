import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  applyPatch,
  parsePatchManifest,
  serializePatchManifest,
  type CommandRunner,
  type PatchManifest,
} from "./patchbot.ts";

describe("Patchbot manifests", () => {
  it("parses and serializes intent, constraints, and historical diff metadata", () => {
    const source = `---
name: "compact-sidebar"
description: |
  Keep the sidebar compact.
why: |
  Small screens need more room.
constraints:
  - "Keep keyboard navigation."
  - "Do not change mobile."
files_touched:
  - "apps/web/src/sidebar.ts"
source_branch: "custom/sidebar"
source_pr: "https://example.test/pr/42"
base: "main"
reference_diff: "history/main.patch"
---

# Notes
`;
    const manifest = parsePatchManifest(source);
    expect(manifest).toEqual({
      name: "compact-sidebar",
      description: "Keep the sidebar compact.",
      why: "Small screens need more room.",
      constraints: ["Keep keyboard navigation.", "Do not change mobile."],
      filesTouched: ["apps/web/src/sidebar.ts"],
      sourceBranch: "custom/sidebar",
      sourcePr: "https://example.test/pr/42",
      base: "main",
      referenceDiff: "history/main.patch",
    });
    expect(parsePatchManifest(serializePatchManifest(manifest))).toEqual(manifest);
  });
});

describe("Patchbot apply", () => {
  it("uses git's clean path without invoking the agent", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "patchbot-"));
    const patchDirectory = join(repositoryRoot, "tools", "patchbot", "patches", "sidebar");
    await mkdir(join(patchDirectory, "history"), { recursive: true });
    const manifest: PatchManifest = {
      name: "sidebar",
      description: "Compact sidebar.",
      why: "More editor space.",
      constraints: ["Keep navigation."],
      filesTouched: ["apps/web/src/sidebar.ts"],
      sourceBranch: "custom/sidebar",
      base: "main",
      referenceDiff: "history/sidebar.patch",
    };
    await writeFile(join(patchDirectory, "Patch.md"), serializePatchManifest(manifest));
    await writeFile(join(patchDirectory, "history", "sidebar.patch"), "diff --git a/file b/file\n");

    const calls: string[][] = [];
    const runner: CommandRunner = async (command, args) => {
      calls.push([command, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    };
    let agentCalled = false;
    const result = await applyPatch(repositoryRoot, "sidebar", {
      runner,
      agent: async () => {
        agentCalled = true;
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toEqual({ name: "sidebar", status: "clean" });
    expect(agentCalled).toBe(false);
    expect(calls).toEqual([
      ["git", "apply", "--check", "--3way", join(patchDirectory, "history", "sidebar.patch")],
      ["git", "apply", "--3way", "--index", join(patchDirectory, "history", "sidebar.patch")],
    ]);
  });

  it("hands a stale patch to the mocked agent fallback", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "patchbot-"));
    const patchDirectory = join(repositoryRoot, "tools", "patchbot", "patches", "stale");
    await mkdir(join(patchDirectory, "history"), { recursive: true });
    const manifest: PatchManifest = {
      name: "stale",
      description: "A patch whose old context moved.",
      why: "Keep the customization.",
      constraints: ["Preserve behavior."],
      filesTouched: ["file.ts"],
      sourceBranch: "custom/stale",
      base: "main",
      referenceDiff: "history/stale.patch",
    };
    await writeFile(join(patchDirectory, "Patch.md"), serializePatchManifest(manifest));
    await writeFile(join(patchDirectory, "history", "stale.patch"), "obsolete diff\n");

    let prompt = "";
    const result = await applyPatch(repositoryRoot, "stale", {
      runner: async () => ({ code: 1, stdout: "", stderr: "patch does not apply" }),
      agent: async (agentPrompt) => {
        prompt = agentPrompt;
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    expect(result).toEqual({ name: "stale", status: "agent", message: "reapplied by codex" });
    expect(prompt).toContain("A historical reference diff is available at");
    expect(prompt).toContain("Preserve behavior.");
  });
});
