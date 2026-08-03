import {
  MAX_SCRIPT_ID_LENGTH,
  SCRIPT_RUN_COMMAND_PATTERN,
  type KeybindingCommand,
  type ProjectScript,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
const isScriptRunCommand = Schema.is(SCRIPT_RUN_COMMAND_PATTERN);

export interface ProjectScriptInput {
  readonly name: ProjectScript["name"];
  readonly command: ProjectScript["command"];
  readonly icon: ProjectScript["icon"];
  readonly runOnWorktreeCreate: ProjectScript["runOnWorktreeCreate"];
  readonly previewUrl: Exclude<ProjectScript["previewUrl"], undefined> | null;
  readonly autoOpenPreview: boolean;
}

export function buildProjectScript(id: string, input: ProjectScriptInput): ProjectScript {
  return {
    id,
    name: input.name,
    command: input.command,
    icon: input.icon,
    runOnWorktreeCreate: input.runOnWorktreeCreate,
    ...(input.previewUrl === null
      ? {}
      : {
          previewUrl: input.previewUrl,
          autoOpenPreview: input.autoOpenPreview,
        }),
  };
}

function normalizeScriptId(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) {
    return "script";
  }
  if (cleaned.length <= MAX_SCRIPT_ID_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_SCRIPT_ID_LENGTH).replace(/-+$/g, "") || "script";
}

export const commandForProjectScript = (scriptId: string): KeybindingCommand =>
  SCRIPT_RUN_COMMAND_PATTERN.make(`script.${scriptId}.run`);

export function projectScriptIdFromCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!isScriptRunCommand(trimmed)) {
    return null;
  }
  const [prefix, , suffix] = SCRIPT_RUN_COMMAND_PATTERN.parts;
  return trimmed.slice(prefix.literal.length, -suffix.literal.length);
}

export function nextProjectScriptId(name: string, existingIds: Iterable<string>): string {
  const taken = new Set(Array.from(existingIds));
  const baseId = normalizeScriptId(name);
  if (!taken.has(baseId)) return baseId;

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${baseId}-${suffix}`;
    const safeCandidate =
      candidate.length <= MAX_SCRIPT_ID_LENGTH
        ? candidate
        : `${baseId.slice(0, Math.max(1, MAX_SCRIPT_ID_LENGTH - String(suffix).length - 1))}-${suffix}`;
    if (!taken.has(safeCandidate)) {
      return safeCandidate;
    }
    suffix += 1;
  }

  // This last-resort fallback only triggers after exhausting thousands of suffixes.
  return `${baseId}-${Date.now()}`.slice(0, MAX_SCRIPT_ID_LENGTH);
}

export function primaryProjectScript(scripts: ReadonlyArray<ProjectScript>): ProjectScript | null {
  const regular = scripts.find((script) => !script.runOnWorktreeCreate);
  return regular ?? scripts[0] ?? null;
}

/**
 * Applies checked-in project scripts to the persisted action list while
 * preserving action ids. UI-only actions remain available, but matching
 * actions follow the file when the user selects t3.json as the source.
 */
export function mergeT3ProjectScripts(
  scripts: ReadonlyArray<ProjectScript>,
  fileScripts: ReadonlyArray<T3ProjectFileScript>,
): ReadonlyArray<ProjectScript> {
  const usedScriptIds = new Set<string>();
  const nextScripts = Array.from(scripts);
  let fileSetupScriptId: string | null = null;

  for (const fileScript of fileScripts) {
    const matchByNameIndex = nextScripts.findIndex(
      (script) =>
        !usedScriptIds.has(script.id) &&
        script.name.toLowerCase() === fileScript.name.toLowerCase(),
    );
    const matchIndex =
      matchByNameIndex !== -1
        ? matchByNameIndex
        : nextScripts.findIndex(
            (script) =>
              !usedScriptIds.has(script.id) && script.command.trim() === fileScript.command.trim(),
          );
    const existing = matchIndex === -1 ? null : nextScripts[matchIndex];
    const nextScript = existing
      ? buildProjectScript(existing.id, {
          name: fileScript.name,
          command: fileScript.command,
          icon: fileScript.icon ?? existing.icon,
          runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
          previewUrl: fileScript.previewUrl ?? null,
          autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
        })
      : buildProjectScript(
          nextProjectScriptId(
            fileScript.name,
            nextScripts.map(({ id }) => id),
          ),
          {
            name: fileScript.name,
            command: fileScript.command,
            icon: fileScript.icon ?? "play",
            runOnWorktreeCreate: fileScript.runOnWorktreeCreate ?? false,
            previewUrl: fileScript.previewUrl ?? null,
            autoOpenPreview: fileScript.previewUrl ? (fileScript.autoOpenPreview ?? false) : false,
          },
        );

    if (fileScript.runOnWorktreeCreate === true && fileSetupScriptId === null) {
      fileSetupScriptId = nextScript.id;
    }
    if (existing && matchIndex !== -1) {
      nextScripts[matchIndex] = nextScript;
      usedScriptIds.add(existing.id);
    } else {
      nextScripts.push(nextScript);
      usedScriptIds.add(nextScript.id);
    }
  }

  if (fileScripts.length === 0) return nextScripts;
  return nextScripts.map((script) => ({
    ...script,
    runOnWorktreeCreate: script.id === fileSetupScriptId,
  }));
}

export function areProjectScriptsEqual(
  left: ReadonlyArray<ProjectScript>,
  right: ReadonlyArray<ProjectScript>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
