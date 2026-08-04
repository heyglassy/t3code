#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, relative, resolve, sep } from "node:path";

const execFile = promisify(execFileCallback);

export type PatchManifest = {
  readonly name: string;
  readonly description: string;
  readonly why: string;
  readonly constraints: ReadonlyArray<string>;
  readonly filesTouched: ReadonlyArray<string>;
  readonly sourceBranch: string;
  readonly sourcePr?: string;
  readonly base: string;
  readonly referenceDiff: string;
};

export type CommandResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type CommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
) => Promise<CommandResult>;

export type AgentRunner = (prompt: string, cwd: string) => Promise<CommandResult>;

const runCommand: CommandRunner = async (command, args, cwd) => {
  try {
    const result = await execFile(command, [...args], { cwd, maxBuffer: 50 * 1024 * 1024 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      code: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message ?? "",
    };
  }
};

const runCodex: AgentRunner = (prompt, cwd) =>
  runCommand("codex", ["exec", "--full-auto", prompt], cwd);

const DEFAULT_BASE = "main";
const FRONTMATTER_START = "---";

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseList(
  lines: ReadonlyArray<string>,
  start: number,
  indentation: number,
): { value: string[]; next: number } {
  const value: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }
    const leadingSpaces = line.length - line.trimStart().length;
    if (leadingSpaces < indentation || !line.trimStart().startsWith("-")) break;
    value.push(unquote(line.trimStart().slice(1).trim()));
    index += 1;
  }
  return { value, next: index };
}

/** Parse the intentionally small YAML frontmatter format documented by Patchbot. */
export function parsePatchManifest(source: string): PatchManifest {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  if (lines[0]?.trim() !== FRONTMATTER_START)
    throw new Error("Patch.md must start with YAML frontmatter (---)");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_START);
  if (end < 0) throw new Error("Patch.md frontmatter is missing its closing ---");

  const scalar = new Map<string, string>();
  const lists = new Map<string, string[]>();
  for (let index = 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) throw new Error(`Invalid frontmatter line: ${line}`);
    const key = line.slice(0, colon).trim().toLowerCase().replaceAll(" ", "_");
    const rawValue = line.slice(colon + 1).trim();
    if (rawValue === "|" || rawValue === ">") {
      const block: string[] = [];
      index += 1;
      while (index < end) {
        const blockLine = lines[index] ?? "";
        if (blockLine.trim() && !blockLine.startsWith("  ")) break;
        block.push(blockLine.replace(/^ {2}/, ""));
        index += 1;
      }
      while (block.at(-1) === "") block.pop();
      scalar.set(key, rawValue === ">" ? block.join(" ") : block.join("\n"));
      index -= 1;
    } else if (rawValue === "") {
      const parsed = parseList(lines, index + 1, 2);
      if (parsed.value.length > 0) {
        lists.set(key, parsed.value);
        index = parsed.next - 1;
      } else {
        scalar.set(key, "");
      }
    } else {
      scalar.set(key, unquote(rawValue));
    }
  }

  const required = (key: string): string => {
    const value = scalar.get(key)?.trim();
    if (!value) throw new Error(`Patch.md is missing required field: ${key.replaceAll("_", " ")}`);
    return value;
  };
  const constraints = lists.get("constraints") ?? [];
  const filesTouched = lists.get("files_touched") ?? lists.get("files") ?? [];
  return {
    name: required("name"),
    description: required("description"),
    why: required("why"),
    constraints,
    filesTouched,
    sourceBranch: required("source_branch"),
    ...(scalar.get("source_pr") ? { sourcePr: scalar.get("source_pr") } : {}),
    base: scalar.get("base")?.trim() || DEFAULT_BASE,
    referenceDiff: scalar.get("reference_diff")?.trim() || "history/latest.patch",
  };
}

function quote(value: string): string {
  return JSON.stringify(value);
}

export function serializePatchManifest(manifest: PatchManifest): string {
  const block = (key: string, value: string): string =>
    `${key}: |\n  ${value.replaceAll("\n", "\n  ")}`;
  const list = (key: string, values: ReadonlyArray<string>): string =>
    `${key}:\n${values.map((item) => `  - ${quote(item)}`).join("\n")}`;
  return [
    FRONTMATTER_START,
    `name: ${quote(manifest.name)}`,
    block("description", manifest.description),
    block("why", manifest.why),
    list("constraints", manifest.constraints),
    list("files_touched", manifest.filesTouched),
    `source_branch: ${quote(manifest.sourceBranch)}`,
    ...(manifest.sourcePr ? [`source_pr: ${quote(manifest.sourcePr)}`] : []),
    `base: ${quote(manifest.base)}`,
    `reference_diff: ${quote(manifest.referenceDiff)}`,
    FRONTMATTER_START,
    "",
    "# Patch notes",
    "",
    "Edit the frontmatter to keep the patch's intent and invariants current. The historical diff is reference material; the manifest is the durable contract.",
    "",
  ].join("\n");
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "patch";
}

async function git(
  cwd: string,
  args: ReadonlyArray<string>,
  runner: CommandRunner = runCommand,
): Promise<string> {
  const result = await runner("git", args, cwd);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout;
}

async function gitResult(
  cwd: string,
  args: ReadonlyArray<string>,
  runner: CommandRunner,
): Promise<CommandResult> {
  return runner("git", args, cwd);
}

export async function resolveRepositoryRoot(
  cwd: string,
  runner: CommandRunner = runCommand,
): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-toplevel"], runner)).trim();
}

export function patchRoot(repositoryRoot: string): string {
  return join(repositoryRoot, "tools", "patchbot", "patches");
}

async function resolvePatchFile(repositoryRoot: string, input: string): Promise<string> {
  const root = patchRoot(repositoryRoot);
  const candidates = [
    resolve(repositoryRoot, input),
    join(root, input),
    join(root, input, "Patch.md"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const suffix = candidate.endsWith(`${sep}Patch.md`) ? candidate : join(candidate, "Patch.md");
      try {
        await access(suffix);
        return suffix;
      } catch {
        if (candidate.endsWith("Patch.md")) return candidate;
      }
    } catch {
      // Try the next convention.
    }
  }
  throw new Error(`Patch not found: ${input}`);
}

async function loadPatch(
  repositoryRoot: string,
  input: string,
): Promise<{ file: string; directory: string; manifest: PatchManifest }> {
  const file = await resolvePatchFile(repositoryRoot, input);
  return {
    file,
    directory: resolve(file, ".."),
    manifest: parsePatchManifest(await readFile(file, "utf8")),
  };
}

async function diffForPatch(
  repositoryRoot: string,
  patch: { directory: string; manifest: PatchManifest },
): Promise<string> {
  const path = resolve(patch.directory, patch.manifest.referenceDiff);
  try {
    await access(path);
    return path;
  } catch {
    throw new Error(`Reference diff does not exist: ${relative(repositoryRoot, path)}`);
  }
}

export type ApplyOutcome = {
  readonly name: string;
  readonly status: "clean" | "agent";
  readonly message?: string;
};

function agentPrompt(manifest: PatchManifest, diffPath: string): string {
  const constraints =
    manifest.constraints.map((item) => `- ${item}`).join("\n") ||
    "- Preserve the documented behavior and run the relevant tests.";
  return `Reapply the Patchbot patch below to the current checkout. Make the smallest implementation change that preserves the patch intent. Do not commit changes.

Patch: ${manifest.name}
Description: ${manifest.description}
Why: ${manifest.why}
Files originally touched: ${manifest.filesTouched.join(", ") || "(not recorded)"}
Constraints:
${constraints}

A historical reference diff is available at ${diffPath}. Inspect it for context, but adapt the implementation to the current code rather than forcing an obsolete patch. Run focused tests or checks when practical.`;
}

export async function applyPatch(
  repositoryRoot: string,
  input: string,
  options: {
    readonly runner?: CommandRunner;
    readonly agent?: AgentRunner;
    readonly allowAgent?: boolean;
  } = {},
): Promise<ApplyOutcome> {
  const runner = options.runner ?? runCommand;
  const agent = options.agent ?? runCodex;
  const patch = await loadPatch(repositoryRoot, input);
  const diffPath = await diffForPatch(repositoryRoot, patch);
  const check = await gitResult(repositoryRoot, ["apply", "--check", "--3way", diffPath], runner);
  if (check.code === 0) {
    const applied = await gitResult(
      repositoryRoot,
      ["apply", "--3way", "--index", diffPath],
      runner,
    );
    if (applied.code !== 0)
      throw new Error(`${patch.manifest.name}: check passed but apply failed: ${applied.stderr}`);
    return { name: patch.manifest.name, status: "clean" };
  }
  if (options.allowAgent === false) {
    return {
      name: patch.manifest.name,
      status: "agent",
      message: check.stderr.trim() || "patch does not apply cleanly",
    };
  }
  const result = await agent(agentPrompt(patch.manifest, diffPath), repositoryRoot);
  if (result.code !== 0)
    throw new Error(`${patch.manifest.name}: codex fallback failed: ${result.stderr.trim()}`);
  return { name: patch.manifest.name, status: "agent", message: "reapplied by codex" };
}

export async function statusPatches(
  repositoryRoot: string,
  runner: CommandRunner = runCommand,
): Promise<ReadonlyArray<ApplyOutcome>> {
  const patches = await discoverPatches(repositoryRoot);
  return Promise.all(
    patches.map(async (input) => applyPatch(repositoryRoot, input, { runner, allowAgent: false })),
  );
}

export async function discoverPatches(repositoryRoot: string): Promise<ReadonlyArray<string>> {
  const root = patchRoot(repositoryRoot);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries.sort()) {
    try {
      await access(join(root, entry, "Patch.md"));
      result.push(entry);
    } catch {
      // Ignore README files and incomplete directories.
    }
  }
  return result;
}

export async function capturePatch(
  repositoryRoot: string,
  branch: string,
  options: {
    readonly base?: string;
    readonly name?: string;
    readonly description?: string;
    readonly why?: string;
    readonly constraints?: ReadonlyArray<string>;
    readonly sourcePr?: string;
    readonly runner?: CommandRunner;
  } = {},
): Promise<string> {
  const runner = options.runner ?? runCommand;
  const base = options.base ?? DEFAULT_BASE;
  const name = options.name ?? branch.replace(/^refs\/heads\//, "");
  const slug = slugify(name);
  const outputDirectory = join(patchRoot(repositoryRoot), slug);
  const historyDirectory = join(outputDirectory, "history");
  const baseSha = (await git(repositoryRoot, ["rev-parse", base], runner)).trim().slice(0, 12);
  const branchSha = (await git(repositoryRoot, ["rev-parse", branch], runner)).trim().slice(0, 12);
  const files = (await git(repositoryRoot, ["diff", "--name-only", `${base}...${branch}`], runner))
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
  const diff = await git(
    repositoryRoot,
    ["diff", "--binary", "--full-index", `${base}...${branch}`],
    runner,
  );
  const referenceDiff = `history/${baseSha}-${branchSha}.patch`;
  await mkdir(historyDirectory, { recursive: true });
  await writeFile(join(outputDirectory, referenceDiff), diff);
  const manifest: PatchManifest = {
    name,
    description: options.description ?? `Long-lived customization from ${branch}.`,
    why:
      options.why ??
      "Document why this customization should continue to exist as upstream changes.",
    constraints: options.constraints ?? ["Preserve the behavior described above."],
    filesTouched: files,
    sourceBranch: branch,
    ...(options.sourcePr ? { sourcePr: options.sourcePr } : {}),
    base,
    referenceDiff,
  };
  await writeFile(join(outputDirectory, "Patch.md"), serializePatchManifest(manifest));
  return outputDirectory;
}

function printUsage(): void {
  console.error(`Usage:
  patchbot capture <branch> [--base <ref>] [--name <name>] [--description <text>] [--why <text>] [--source-pr <url>]
  patchbot apply <patch>
  patchbot apply --all
  patchbot status`);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function main(args: ReadonlyArray<string> = process.argv.slice(2)): Promise<number> {
  const command = args[0];
  if (!command) {
    printUsage();
    return 2;
  }
  const repositoryRoot = await resolveRepositoryRoot(process.cwd());
  if (command === "capture") {
    const branch = args[1];
    if (!branch) throw new Error("capture requires a branch");
    const output = await capturePatch(repositoryRoot, branch, {
      base: option([...args], "--base"),
      name: option([...args], "--name"),
      description: option([...args], "--description"),
      why: option([...args], "--why"),
      sourcePr: option([...args], "--source-pr"),
    });
    console.log(`Captured patch at ${relative(repositoryRoot, output)}`);
    return 0;
  }
  if (command === "apply") {
    const inputs = args[1] === "--all" ? await discoverPatches(repositoryRoot) : args.slice(1);
    if (inputs.length === 0) throw new Error("apply requires a patch or --all (no patches found)");
    for (const input of inputs) {
      const outcome = await applyPatch(repositoryRoot, input);
      console.log(
        `${outcome.name}: ${outcome.status}${outcome.message ? ` (${outcome.message})` : ""}`,
      );
    }
    return 0;
  }
  if (command === "status") {
    const outcomes = await statusPatches(repositoryRoot);
    for (const outcome of outcomes) console.log(`${outcome.name}: ${outcome.status}`);
    return outcomes.every((outcome) => outcome.status === "clean") ? 0 : 1;
  }
  printUsage();
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
