import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type {
  ConfigDiagnostic,
  LoadedModeConfig,
  ModeConfig,
  ModeConfigSource,
  ModeDefinition,
  ThinkingLevel,
} from "./types.ts";
import { THINKING_LEVELS } from "./types.ts";

const ROOT_FIELDS = new Set(["version", "defaultMode", "modes"]);
const MODE_FIELDS = new Set([
  "model",
  "tools",
  "excludeTools",
  "skills",
  "excludeSkills",
  "thinkingLevel",
  "instructions",
]);

export class ConfigValidationError extends Error {
  constructor(
    readonly filePath: string,
    readonly field: string,
    message: string,
  ) {
    super(`${filePath}:${field}: ${message}`);
    this.name = "ConfigValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(filePath: string, field: string, message: string): never {
  throw new ConfigValidationError(filePath, field, message);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  filePath: string,
  field: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(filePath, field, `unknown field "${key}"`);
  }
}

function requiredString(value: unknown, filePath: string, field: string): string {
  const label = field.split(".").at(-1) ?? field;
  if (typeof value !== "string" || value.trim() === "") fail(filePath, field, `${label} must be a string`);
  return value.trim();
}

function stringList(value: unknown, filePath: string, field: string): string[] {
  const label = field.split(".").at(-1) ?? field;
  if (!Array.isArray(value)) fail(filePath, field, `${label} must be an array`);
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      fail(filePath, field, `${label} entries must be non-empty strings`);
    }
    const item = entry.trim();
    if (!normalized.includes(item)) normalized.push(item);
  }
  return normalized;
}

function optionalStringList(value: unknown, filePath: string, field: string): string[] | undefined {
  return value === undefined ? undefined : stringList(value, filePath, field);
}

function parseMode(value: unknown, filePath: string, field: string): ModeDefinition {
  if (!isRecord(value)) fail(filePath, field, "mode must be a mapping");
  rejectUnknownFields(value, MODE_FIELDS, filePath, field);

  const model = requiredString(value.model, filePath, `${field}.model`);
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    fail(filePath, `${field}.model`, "model must use provider/model-id");
  }

  let thinkingLevel: ThinkingLevel | undefined;
  if (value.thinkingLevel !== undefined) {
    if (typeof value.thinkingLevel !== "string" || !THINKING_LEVELS.includes(value.thinkingLevel as ThinkingLevel)) {
      fail(filePath, `${field}.thinkingLevel`, `thinkingLevel must be one of ${THINKING_LEVELS.join(", ")}`);
    }
    thinkingLevel = value.thinkingLevel as ThinkingLevel;
  }

  let instructions: string | undefined;
  if (value.instructions !== undefined) {
    if (typeof value.instructions !== "string" || value.instructions.trim() === "") {
      fail(filePath, `${field}.instructions`, "instructions must be a non-empty string");
    }
    instructions = value.instructions;
  }

  const tools = optionalStringList(value.tools, filePath, `${field}.tools`);
  const excludeTools = optionalStringList(value.excludeTools, filePath, `${field}.excludeTools`);
  const skills = optionalStringList(value.skills, filePath, `${field}.skills`);
  const excludeSkills = optionalStringList(value.excludeSkills, filePath, `${field}.excludeSkills`);
  if (tools === undefined && excludeTools === undefined) {
    fail(filePath, field, "mode must define tools or excludeTools");
  }
  if (skills === undefined && excludeSkills === undefined) {
    fail(filePath, field, "mode must define skills or excludeSkills");
  }

  return {
    model,
    provider: model.slice(0, separator),
    modelId: model.slice(separator + 1),
    ...(tools !== undefined ? { tools } : {}),
    ...(excludeTools !== undefined ? { excludeTools } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(excludeSkills !== undefined ? { excludeSkills } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

export function parseModeConfig(source: string, filePath: string): ModeConfigSource {
  let value: unknown;
  try {
    value = parse(source, { uniqueKeys: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid YAML";
    fail(filePath, "$", `invalid YAML: ${message}`);
  }

  if (!isRecord(value)) fail(filePath, "$", "config must be a mapping");
  rejectUnknownFields(value, ROOT_FIELDS, filePath, "$");
  if (value.version !== 1) fail(filePath, "version", "version must be 1");

  let defaultMode: string | undefined;
  if (value.defaultMode !== undefined) defaultMode = requiredString(value.defaultMode, filePath, "defaultMode");

  if (!isRecord(value.modes) || Object.keys(value.modes).length === 0) {
    fail(filePath, "modes", "modes must be a non-empty mapping");
  }

  const modes: Record<string, ModeDefinition> = {};
  for (const [rawName, mode] of Object.entries(value.modes)) {
    const name = rawName.trim();
    if (name === "" || name !== rawName) {
      fail(filePath, `modes.${rawName}`, "mode names must be non-empty and cannot have surrounding whitespace");
    }
    modes[name] = parseMode(mode, filePath, `modes.${name}`);
  }

  return { version: 1, ...(defaultMode ? { defaultMode } : {}), modes, sourcePath: filePath };
}

export function mergeModeConfigs(
  globalConfig: ModeConfigSource | undefined,
  projectConfig: ModeConfigSource | undefined,
): ModeConfig {
  const modes = { ...(globalConfig?.modes ?? {}), ...(projectConfig?.modes ?? {}) };
  const defaultMode = projectConfig?.defaultMode ?? globalConfig?.defaultMode;
  const sourcePaths = [globalConfig?.sourcePath, projectConfig?.sourcePath].filter(
    (path): path is string => Boolean(path),
  );
  const diagnosticPath = sourcePaths.at(-1) ?? "modes.yaml";

  if (!defaultMode) fail(diagnosticPath, "defaultMode", "defaultMode is required after merging config files");
  if (!modes[defaultMode]) {
    fail(diagnosticPath, "defaultMode", `defaultMode "${defaultMode}" does not name a configured mode`);
  }

  return { version: 1, defaultMode, modes, sourcePaths };
}

export interface LoadModeConfigOptions {
  cwd: string;
  agentDir: string;
  configDirName: string;
  projectTrusted: boolean;
  readText?: (path: string) => Promise<string>;
}

async function readOptionalConfig(
  path: string,
  readText: (path: string) => Promise<string>,
  diagnostics: ConfigDiagnostic[],
): Promise<ModeConfigSource | undefined> {
  try {
    return parseModeConfig(await readText(path), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    diagnostics.push({ path, message: error instanceof Error ? error.message : "failed to read mode config" });
    return undefined;
  }
}

export async function loadModeConfig(options: LoadModeConfigOptions): Promise<LoadedModeConfig> {
  const globalPath = join(options.agentDir, "modes.yaml");
  const projectPath = join(options.cwd, options.configDirName, "modes.yaml");
  const diagnostics: ConfigDiagnostic[] = [];
  const readText = options.readText ?? ((path: string) => readFile(path, "utf8"));
  const globalConfig = await readOptionalConfig(globalPath, readText, diagnostics);
  const projectConfig = options.projectTrusted
    ? await readOptionalConfig(projectPath, readText, diagnostics)
    : undefined;

  if (!globalConfig && !projectConfig) return { diagnostics, globalPath, projectPath };

  try {
    return { config: mergeModeConfigs(globalConfig, projectConfig), diagnostics, globalPath, projectPath };
  } catch (error) {
    diagnostics.push({
      path: projectConfig?.sourcePath ?? globalConfig?.sourcePath ?? projectPath,
      message: error instanceof Error ? error.message : "invalid merged mode config",
    });
  }

  for (const fallback of [globalConfig, projectConfig]) {
    if (!fallback) continue;
    try {
      return { config: mergeModeConfigs(fallback, undefined), diagnostics, globalPath, projectPath };
    } catch (error) {
      diagnostics.push({
        path: fallback.sourcePath,
        message: error instanceof Error ? error.message : "invalid fallback mode config",
      });
    }
  }

  return { diagnostics, globalPath, projectPath };
}
