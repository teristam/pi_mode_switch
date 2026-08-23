# Pi Mode Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable pi extension package that loads complete model/tool/skill modes from merged YAML configuration and exposes safe, branch-persistent switching through `/mode` and `mode_switch`.

**Architecture:** Keep YAML parsing/loading, runtime mode application, skill-context generation, and pi event wiring in separate TypeScript modules. The extension validates a target before mutation, always retains its switch tool, persists explicit switches as custom session entries, and appends selected skill contents as ephemeral context before every model request.

**Tech Stack:** TypeScript ESM, pi extension API 0.84.x, TypeBox, `yaml`, Node test runner through `tsx`, `node:assert/strict`.

**Design reference:** `docs/superpowers/specs/2026-08-23-pi-mode-switch-design.md`

---

## File Map

| Path | Responsibility |
|---|---|
| `package.json` | npm/pi package manifest, runtime dependency, peer dependencies, scripts |
| `tsconfig.json` | strict no-emit TypeScript configuration |
| `src/types.ts` | normalized config, mode, diagnostic, and application result types |
| `src/config.ts` | strict YAML parsing, merging, trust-aware file loading, fallback diagnostics |
| `src/mode-controller.ts` | validate and atomically apply model/thinking/tools |
| `src/skills.ts` | discovered-skill lookup, cached file reads, warning deduplication, context rendering |
| `src/index.ts` | pi command/tool/events, status, state restore/persistence, dependency injection for tests |
| `test/config.test.ts` | parser, merge, fallback, and trust behavior |
| `test/mode-controller.test.ts` | mutation order, validation, and rollback behavior |
| `test/skills.test.ts` | selected-skill rendering and warning behavior |
| `test/index.test.ts` | command/tool parity, state, status, schemas, and immediate context switching |
| `modes.example.yaml` | installable plan/code example used by regression tests |
| `README.md` | installation, schema, behavior, trust, errors, reload, security boundary |

## Task 1: Scaffold the pi Package and Shared Types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types.ts`

- [ ] **Step 1: Create the package manifest**

Create `package.json`:

```json
{
  "name": "pi-mode-switch",
  "version": "0.1.0",
  "description": "YAML-defined model, tool, and skill modes for pi",
  "type": "module",
  "keywords": ["pi-package", "pi-extension", "agent-modes"],
  "license": "MIT",
  "files": ["src", "README.md", "modes.example.yaml"],
  "scripts": {
    "test": "tsx --test test/**/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {
    "yaml": "^2.9.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@earendil-works/pi-agent-core": "^0.84.2",
    "@earendil-works/pi-ai": "^0.84.2",
    "@earendil-works/pi-coding-agent": "^0.84.2",
    "@types/node": "^24.0.0",
    "tsx": "^4.20.0",
    "typebox": "^1.3.7",
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 2: Create strict TypeScript configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Define normalized shared types**

Create `src/types.ts`:

```typescript
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ModeDefinition {
  model: string;
  provider: string;
  modelId: string;
  tools: string[];
  skills: string[];
  thinkingLevel?: ThinkingLevel;
  instructions?: string;
}

export interface ModeConfigSource {
  version: 1;
  defaultMode?: string;
  modes: Record<string, ModeDefinition>;
  sourcePath: string;
}

export interface ModeConfig {
  version: 1;
  defaultMode: string;
  modes: Record<string, ModeDefinition>;
  sourcePaths: string[];
}

export interface ConfigDiagnostic {
  path: string;
  message: string;
}

export interface LoadedModeConfig {
  config?: ModeConfig;
  diagnostics: ConfigDiagnostic[];
  globalPath: string;
  projectPath: string;
}

export interface AppliedMode {
  name: string;
  definition: ModeDefinition;
  activeTools: string[];
  effectiveThinkingLevel: ThinkingLevel;
}

export interface ModeSwitchState {
  mode: string;
}
```

- [ ] **Step 4: Install dependencies and verify the initial type surface**

Run:

```bash
npm install
npm run typecheck
```

Expected: dependency installation succeeds and `tsc --noEmit` exits with code 0.

- [ ] **Step 5: Commit the scaffold**

```bash
git add package.json package-lock.json tsconfig.json src/types.ts
git commit -m "chore: scaffold pi mode switch package"
```

## Task 2: Parse and Validate One YAML Config File

**Files:**
- Create: `test/config.test.ts`
- Create: `src/config.ts`

- [ ] **Step 1: Write parser tests first**

Create `test/config.test.ts` with the parser cases:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { ConfigValidationError, parseModeConfig } from "../src/config.ts";

const VALID = `
version: 1
defaultMode: plan
modes:
  plan:
    model: openrouter/anthropic/claude-sonnet-4
    thinkingLevel: high
    tools: [read, read, grep]
    skills: [brainstorming, brainstorming]
    instructions: Plan without editing.
`;

test("parseModeConfig normalizes a complete mode", () => {
  const parsed = parseModeConfig(VALID, "/config/modes.yaml");
  assert.equal(parsed.defaultMode, "plan");
  assert.deepEqual(parsed.modes.plan, {
    model: "openrouter/anthropic/claude-sonnet-4",
    provider: "openrouter",
    modelId: "anthropic/claude-sonnet-4",
    thinkingLevel: "high",
    tools: ["read", "grep"],
    skills: ["brainstorming"],
    instructions: "Plan without editing.",
  });
});

for (const [name, source, message] of [
  ["unsupported version", VALID.replace("version: 1", "version: 2"), "version must be 1"],
  ["unknown root field", `${VALID}\nextra: true\n`, "unknown field \"extra\""],
  ["unknown mode field", VALID.replace("    tools:", "    extra: true\n    tools:"), "unknown field \"extra\""],
  ["missing model", VALID.replace("    model: openrouter/anthropic/claude-sonnet-4\n", ""), "model must be a string"],
  ["bad model", VALID.replace("openrouter/anthropic/claude-sonnet-4", "no-slash"), "model must use provider/model-id"],
  ["bad thinking", VALID.replace("thinkingLevel: high", "thinkingLevel: huge"), "thinkingLevel must be one of"],
  ["bad tools", VALID.replace("tools: [read, read, grep]", "tools: read"), "tools must be an array"],
  ["bad skills", VALID.replace("skills: [brainstorming, brainstorming]", "skills: [\"\"]"), "skills entries must be non-empty strings"],
] as const) {
  test(`parseModeConfig rejects ${name}`, () => {
    assert.throws(
      () => parseModeConfig(source, "/config/modes.yaml"),
      (error: unknown) => error instanceof ConfigValidationError && error.message.includes(message),
    );
  });
}
```

- [ ] **Step 2: Run the parser tests and confirm they fail**

Run:

```bash
npm test -- --test-name-pattern="parseModeConfig"
```

Expected: FAIL because `src/config.ts` does not exist.

- [ ] **Step 3: Implement strict parsing and normalization**

Create `src/config.ts` with parser behavior:

```typescript
import { parse } from "yaml";
import { THINKING_LEVELS, type ModeConfigSource, type ModeDefinition, type ThinkingLevel } from "./types.ts";

const ROOT_FIELDS = new Set(["version", "defaultMode", "modes"]);
const MODE_FIELDS = new Set(["model", "tools", "skills", "thinkingLevel", "instructions"]);

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
  if (typeof value !== "string" || value.trim() === "") fail(filePath, field, `${field.split(".").at(-1)} must be a string`);
  return value.trim();
}

function stringList(value: unknown, filePath: string, field: string): string[] {
  const label = field.split(".").at(-1)!;
  if (!Array.isArray(value)) fail(filePath, field, `${label} must be an array`);
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") fail(filePath, field, `${label} entries must be non-empty strings`);
    const item = entry.trim();
    if (!normalized.includes(item)) normalized.push(item);
  }
  return normalized;
}

function parseMode(value: unknown, filePath: string, field: string): ModeDefinition {
  if (!isRecord(value)) fail(filePath, field, "mode must be a mapping");
  rejectUnknownFields(value, MODE_FIELDS, filePath, field);

  const model = requiredString(value.model, filePath, `${field}.model`);
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) fail(filePath, `${field}.model`, "model must use provider/model-id");

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

  return {
    model,
    provider: model.slice(0, separator),
    modelId: model.slice(separator + 1),
    tools: stringList(value.tools, filePath, `${field}.tools`),
    skills: stringList(value.skills, filePath, `${field}.skills`),
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

  if (!isRecord(value.modes) || Object.keys(value.modes).length === 0) fail(filePath, "modes", "modes must be a non-empty mapping");
  const modes: Record<string, ModeDefinition> = {};
  for (const [rawName, mode] of Object.entries(value.modes)) {
    const name = rawName.trim();
    if (name === "" || name !== rawName) fail(filePath, `modes.${rawName}`, "mode names must be non-empty and cannot have surrounding whitespace");
    modes[name] = parseMode(mode, filePath, `modes.${name}`);
  }

  return { version: 1, ...(defaultMode ? { defaultMode } : {}), modes, sourcePath: filePath };
}
```

- [ ] **Step 4: Run parser tests and type-check**

Run:

```bash
npm test -- --test-name-pattern="parseModeConfig"
npm run typecheck
```

Expected: parser tests PASS and type-check exits with code 0.

- [ ] **Step 5: Commit the parser**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: validate YAML mode profiles"
```

## Task 3: Merge Global and Trusted Project Config

**Files:**
- Modify: `src/config.ts`
- Modify: `test/config.test.ts`

- [ ] **Step 1: Add merge, fallback, and trust tests**

Append to `test/config.test.ts`:

```typescript
import { join } from "node:path";
import { loadModeConfig, mergeModeConfigs } from "../src/config.ts";

const GLOBAL = `
version: 1
defaultMode: plan
modes:
  plan:
    model: openai/gpt-plan
    tools: [read]
    skills: []
  code:
    model: anthropic/old-code
    tools: [read, edit]
    skills: []
`;

const PROJECT = `
version: 1
defaultMode: code
modes:
  code:
    model: anthropic/new-code
    tools: [read, write]
    skills: [test-driven-development]
`;

test("mergeModeConfigs replaces complete project modes", () => {
  const merged = mergeModeConfigs(
    parseModeConfig(GLOBAL, "/global/modes.yaml"),
    parseModeConfig(PROJECT, "/project/modes.yaml"),
  );
  assert.equal(merged.defaultMode, "code");
  assert.equal(merged.modes.plan.model, "openai/gpt-plan");
  assert.equal(merged.modes.code.model, "anthropic/new-code");
  assert.deepEqual(merged.sourcePaths, ["/global/modes.yaml", "/project/modes.yaml"]);
});

function missingFile(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`missing ${path}`), { code: "ENOENT" });
}

test("loadModeConfig does not read an untrusted project file", async () => {
  const reads: string[] = [];
  const globalPath = join("/agent", "modes.yaml");
  const loaded = await loadModeConfig({
    cwd: "/repo",
    agentDir: "/agent",
    configDirName: ".pi",
    projectTrusted: false,
    readText: async (path) => {
      reads.push(path);
      if (path === globalPath) return GLOBAL;
      throw missingFile(path);
    },
  });
  assert.equal(loaded.config?.defaultMode, "plan");
  assert.deepEqual(reads, [globalPath]);
});

test("loadModeConfig can use a valid project when global config is invalid", async () => {
  const globalPath = join("/agent", "modes.yaml");
  const projectPath = join("/repo", ".pi", "modes.yaml");
  const loaded = await loadModeConfig({
    cwd: "/repo",
    agentDir: "/agent",
    configDirName: ".pi",
    projectTrusted: true,
    readText: async (path) => {
      if (path === globalPath) return "version: 2\nmodes: {}\n";
      if (path === projectPath) return PROJECT;
      throw missingFile(path);
    },
  });
  assert.equal(loaded.config?.defaultMode, "code");
  assert.equal(loaded.config?.modes.code.model, "anthropic/new-code");
  assert.ok(loaded.diagnostics.some((diagnostic) => diagnostic.path === globalPath));
});

test("loadModeConfig ignores an invalid project and retains global config", async () => {
  const globalPath = join("/agent", "modes.yaml");
  const projectPath = join("/repo", ".pi", "modes.yaml");
  const loaded = await loadModeConfig({
    cwd: "/repo",
    agentDir: "/agent",
    configDirName: ".pi",
    projectTrusted: true,
    readText: async (path) => {
      if (path === globalPath) return GLOBAL;
      if (path === projectPath) return PROJECT.replace("defaultMode: code", "defaultMode: absent");
      throw missingFile(path);
    },
  });
  assert.equal(loaded.config?.defaultMode, "plan");
  assert.ok(loaded.diagnostics.some((diagnostic) => diagnostic.message.includes("defaultMode \"absent\" does not name a configured mode")));
});

test("loadModeConfig reports both paths when neither file exists", async () => {
  const loaded = await loadModeConfig({
    cwd: "/repo",
    agentDir: "/agent",
    configDirName: ".pi",
    projectTrusted: true,
    readText: async (path) => {
      throw missingFile(path);
    },
  });
  assert.equal(loaded.config, undefined);
  assert.equal(loaded.globalPath, join("/agent", "modes.yaml"));
  assert.equal(loaded.projectPath, join("/repo", ".pi", "modes.yaml"));
  assert.deepEqual(loaded.diagnostics, []);
});
```

Consolidate the two imports from `../src/config.ts` into one import statement containing `ConfigValidationError`, `loadModeConfig`, `mergeModeConfigs`, and `parseModeConfig`.

- [ ] **Step 2: Run the new tests and confirm the missing exports**

Run:

```bash
npm test -- --test-name-pattern="mergeModeConfigs|loadModeConfig"
```

Expected: FAIL because `mergeModeConfigs` and `loadModeConfig` are not exported.

- [ ] **Step 3: Implement merging and file loading**

Add these imports at the top of `src/config.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigDiagnostic, LoadedModeConfig, ModeConfig } from "./types.ts";
```

Keep the existing `ModeConfigSource`, `ModeDefinition`, and `ThinkingLevel` type imports in the same `./types.ts` import statement rather than creating duplicate imports. Append:

```typescript
export function mergeModeConfigs(
  globalConfig: ModeConfigSource | undefined,
  projectConfig: ModeConfigSource | undefined,
): ModeConfig {
  const modes = { ...(globalConfig?.modes ?? {}), ...(projectConfig?.modes ?? {}) };
  const defaultMode = projectConfig?.defaultMode ?? globalConfig?.defaultMode;
  const sourcePaths = [globalConfig?.sourcePath, projectConfig?.sourcePath].filter((path): path is string => Boolean(path));
  const diagnosticPath = sourcePaths.at(-1) ?? "modes.yaml";
  if (!defaultMode) fail(diagnosticPath, "defaultMode", "defaultMode is required after merging config files");
  if (!modes[defaultMode]) fail(diagnosticPath, "defaultMode", `defaultMode "${defaultMode}" does not name a configured mode`);
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
```

- [ ] **Step 4: Run all config tests and type-check**

Run:

```bash
npm test -- test/config.test.ts
npm run typecheck
```

Expected: all config tests PASS and type-check exits with code 0.

- [ ] **Step 5: Commit config loading**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: merge global and project mode config"
```

## Task 4: Apply Complete Modes Without Partial State

**Files:**
- Create: `test/mode-controller.test.ts`
- Create: `src/mode-controller.ts`

- [ ] **Step 1: Write controller tests first**

Create `test/mode-controller.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { ModeApplyError, ModeController } from "../src/mode-controller.ts";
import type { ModeConfig, ThinkingLevel } from "../src/types.ts";

const CONFIG: ModeConfig = {
  version: 1,
  defaultMode: "plan",
  sourcePaths: ["/config/modes.yaml"],
  modes: {
    plan: {
      model: "openrouter/anthropic/plan",
      provider: "openrouter",
      modelId: "anthropic/plan",
      tools: ["read", "mode_switch", "read"],
      skills: ["brainstorming"],
      thinkingLevel: "high",
    },
  },
};

function runtime(setModelResult = true) {
  const calls: string[] = [];
  let thinking: ThinkingLevel = "off";
  let tools = ["read", "edit"];
  return {
    calls,
    get tools() { return tools; },
    adapter: {
      getAllToolNames: () => ["read", "edit", "mode_switch"],
      findModel: (provider: string, id: string) => provider === "openrouter" && id === "anthropic/plan" ? { provider, id } : undefined,
      setModel: async () => { calls.push("model"); return setModelResult; },
      setThinkingLevel: (level: ThinkingLevel) => { calls.push("thinking"); thinking = level; },
      getThinkingLevel: () => thinking,
      setActiveTools: (names: string[]) => { calls.push("tools"); tools = names; },
    },
  };
}

test("ModeController applies model before thinking and tools", async () => {
  const fake = runtime();
  const controller = new ModeController(CONFIG, fake.adapter);
  const applied = await controller.apply("plan");
  assert.deepEqual(fake.calls, ["model", "thinking", "tools"]);
  assert.deepEqual(applied.activeTools, ["read", "mode_switch"]);
  assert.equal(applied.effectiveThinkingLevel, "high");
  assert.equal(controller.current?.name, "plan");
});

test("ModeController preserves prior state when model credentials are unavailable", async () => {
  const fake = runtime(false);
  const controller = new ModeController(CONFIG, fake.adapter);
  await assert.rejects(() => controller.apply("plan"), /credentials are unavailable/);
  assert.deepEqual(fake.calls, ["model"]);
  assert.deepEqual(fake.tools, ["read", "edit"]);
  assert.equal(controller.current, undefined);
});

test("ModeController validates resources before mutation", async () => {
  const fake = runtime();
  const unknownTool = structuredClone(CONFIG);
  unknownTool.modes.plan.tools = ["missing"];
  await assert.rejects(() => new ModeController(unknownTool, fake.adapter).apply("plan"), /unknown tools: missing/);
  assert.deepEqual(fake.calls, []);

  await assert.rejects(() => new ModeController(CONFIG, fake.adapter).apply("absent"), /unknown mode "absent"/);
  assert.deepEqual(fake.calls, []);
});

test("ModeController rejects an unknown model before mutation", async () => {
  const fake = runtime();
  const unknownModel = structuredClone(CONFIG);
  unknownModel.modes.plan.modelId = "missing";
  await assert.rejects(() => new ModeController(unknownModel, fake.adapter).apply("plan"), /model openrouter\/missing was not found/);
  assert.deepEqual(fake.calls, []);
});
```

- [ ] **Step 2: Run controller tests and confirm they fail**

Run:

```bash
npm test -- test/mode-controller.test.ts
```

Expected: FAIL because `src/mode-controller.ts` does not exist.

- [ ] **Step 3: Implement the mode controller**

Create `src/mode-controller.ts`:

```typescript
import type { AppliedMode, ModeConfig, ThinkingLevel } from "./types.ts";

export const MODE_SWITCH_TOOL = "mode_switch";

export interface ModeRuntime<ModelType = unknown> {
  getAllToolNames(): string[];
  findModel(provider: string, modelId: string): ModelType | undefined;
  setModel(model: ModelType): Promise<boolean>;
  setThinkingLevel(level: ThinkingLevel): void;
  getThinkingLevel(): ThinkingLevel;
  setActiveTools(names: string[]): void;
}

export class ModeApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModeApplyError";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class ModeController<ModelType = unknown> {
  current: AppliedMode | undefined;

  constructor(
    readonly config: ModeConfig,
    private readonly runtime: ModeRuntime<ModelType>,
  ) {}

  async apply(name: string): Promise<AppliedMode> {
    const definition = this.config.modes[name];
    if (!definition) {
      throw new ModeApplyError(`unknown mode "${name}"; available modes: ${Object.keys(this.config.modes).join(", ")}`);
    }

    const model = this.runtime.findModel(definition.provider, definition.modelId);
    if (!model) throw new ModeApplyError(`model ${definition.provider}/${definition.modelId} was not found`);

    const activeTools = unique([...definition.tools, MODE_SWITCH_TOOL]);
    const available = new Set(this.runtime.getAllToolNames());
    const unknownTools = activeTools.filter((tool) => !available.has(tool));
    if (unknownTools.length > 0) throw new ModeApplyError(`unknown tools: ${unknownTools.join(", ")}`);

    if (!(await this.runtime.setModel(model))) {
      throw new ModeApplyError(`credentials are unavailable for ${definition.provider}/${definition.modelId}`);
    }

    if (definition.thinkingLevel) this.runtime.setThinkingLevel(definition.thinkingLevel);
    this.runtime.setActiveTools(activeTools);

    const applied: AppliedMode = {
      name,
      definition,
      activeTools,
      effectiveThinkingLevel: this.runtime.getThinkingLevel(),
    };
    this.current = applied;
    return applied;
  }
}
```

- [ ] **Step 4: Run controller tests and type-check**

Run:

```bash
npm test -- test/mode-controller.test.ts
npm run typecheck
```

Expected: all controller tests PASS and type-check exits with code 0.

- [ ] **Step 5: Commit the controller**

```bash
git add src/mode-controller.ts test/mode-controller.test.ts
git commit -m "feat: apply complete mode profiles"
```

## Task 5: Build Auto-loaded Skill Context

**Files:**
- Create: `test/skills.test.ts`
- Create: `src/skills.ts`

- [ ] **Step 1: Write skill-context tests first**

Create `test/skills.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { SkillContextBuilder } from "../src/skills.ts";
import type { ModeDefinition } from "../src/types.ts";

const MODE: ModeDefinition = {
  model: "openai/gpt",
  provider: "openai",
  modelId: "gpt",
  tools: ["read"],
  skills: ["alpha", "missing", "broken", "alpha"],
  instructions: "Plan only.",
};

function skill(name: string, filePath: string): Skill {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: filePath.slice(0, filePath.lastIndexOf("/")),
    sourceInfo: {} as Skill["sourceInfo"],
    disableModelInvocation: false,
  };
}

test("SkillContextBuilder includes selected full contents and metadata", async () => {
  const reads: string[] = [];
  const warnings: string[] = [];
  const builder = new SkillContextBuilder(async (path) => {
    reads.push(path);
    if (path.endsWith("broken/SKILL.md")) throw new Error("denied");
    return "---\nname: alpha\n---\n# Alpha instructions";
  });
  builder.setCatalogue([
    skill("alpha", "/skills/alpha/SKILL.md"),
    skill("unselected", "/skills/unselected/SKILL.md"),
    skill("broken", "/skills/broken/SKILL.md"),
  ]);

  const first = await builder.build("plan", MODE, (message) => warnings.push(message));
  const second = await builder.build("plan", MODE, (message) => warnings.push(message));

  assert.match(first, /\[ACTIVE MODE: plan\]/);
  assert.match(first, /Plan only\./);
  assert.match(first, /file: \/skills\/alpha\/SKILL\.md/);
  assert.match(first, /base directory: \/skills\/alpha/);
  assert.match(first, /# Alpha instructions/);
  assert.doesNotMatch(first, /unselected/);
  assert.equal((first.match(/BEGIN AUTO-LOADED SKILL alpha/g) ?? []).length, 1);
  assert.equal(second, first);
  assert.deepEqual(reads, ["/skills/alpha/SKILL.md", "/skills/broken/SKILL.md"]);
  assert.equal(warnings.filter((message) => message.includes("missing")).length, 1);
  assert.equal(warnings.filter((message) => message.includes("broken")).length, 1);
});
```

- [ ] **Step 2: Run skill tests and confirm they fail**

Run:

```bash
npm test -- test/skills.test.ts
```

Expected: FAIL because `src/skills.ts` does not exist.

- [ ] **Step 3: Implement cached selected-skill rendering**

Create `src/skills.ts`:

```typescript
import { readFile } from "node:fs/promises";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { MODE_SWITCH_TOOL } from "./mode-controller.ts";
import type { ModeDefinition } from "./types.ts";

export type SkillReader = (path: string) => Promise<string>;
export type SkillWarning = (message: string) => void;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class SkillContextBuilder {
  private catalogue = new Map<string, Skill>();
  private contentCache = new Map<string, Promise<string | undefined>>();
  private warned = new Set<string>();

  constructor(private readonly readText: SkillReader = (path) => readFile(path, "utf8")) {}

  setCatalogue(skills: Skill[]): void {
    this.catalogue = new Map(skills.map((skill) => [skill.name, skill]));
  }

  private warnOnce(key: string, message: string, warn: SkillWarning): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    warn(message);
  }

  private readSkill(skill: Skill): Promise<string | undefined> {
    let pending = this.contentCache.get(skill.filePath);
    if (!pending) {
      pending = this.readText(skill.filePath).catch(() => undefined);
      this.contentCache.set(skill.filePath, pending);
    }
    return pending;
  }

  async build(modeName: string, mode: ModeDefinition, warn: SkillWarning): Promise<string> {
    const lines = [
      `[ACTIVE MODE: ${modeName}]`,
      `Configured model: ${mode.model}`,
      `Active tools: ${unique([...mode.tools, MODE_SWITCH_TOOL]).join(", ")}`,
      `Auto-loaded skills: ${unique(mode.skills).join(", ") || "(none)"}`,
    ];
    if (mode.instructions) lines.push("", "Mode instructions:", mode.instructions);

    for (const name of unique(mode.skills)) {
      const skill = this.catalogue.get(name);
      if (!skill) {
        this.warnOnce(`missing:${modeName}:${name}`, `Mode "${modeName}": unknown skill "${name}"`, warn);
        continue;
      }
      const content = await this.readSkill(skill);
      if (content === undefined) {
        this.warnOnce(`read:${skill.filePath}`, `Mode "${modeName}": could not read skill "${name}" at ${skill.filePath}`, warn);
        continue;
      }
      lines.push(
        "",
        `--- BEGIN AUTO-LOADED SKILL ${name} ---`,
        `file: ${skill.filePath}`,
        `base directory: ${skill.baseDir}`,
        content,
        `--- END AUTO-LOADED SKILL ${name} ---`,
      );
    }

    return lines.join("\n");
  }
}
```

- [ ] **Step 4: Run skill tests and type-check**

Run:

```bash
npm test -- test/skills.test.ts
npm run typecheck
```

Expected: the skill test PASSes and type-check exits with code 0.

- [ ] **Step 5: Commit skill loading**

```bash
git add src/skills.ts test/skills.test.ts
git commit -m "feat: auto-load mode skills into context"
```

## Task 6: Wire pi Events, Command, Tool, and Session State

**Files:**
- Create: `test/index.test.ts`
- Create: `src/index.ts`

- [ ] **Step 1: Write an extension integration harness and command/tool parity test**

Create `test/index.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createModeSwitchExtension } from "../src/index.ts";

async function fixture() {
  const root = join(tmpdir(), `pi-mode-switch-${process.pid}-${Date.now()}-${Math.random()}`);
  const agentDir = join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "modes.yaml"), `
version: 1
defaultMode: plan
modes:
  plan:
    model: provider/plan-model
    thinkingLevel: high
    tools: [read]
    skills: []
    instructions: Plan only.
  code:
    model: provider/code-model
    thinkingLevel: medium
    tools: [read, edit]
    skills: []
    instructions: Code now.
`, "utf8");
  return { root, agentDir };
}

test("command and tool share switching, persistence, status, and schema", async () => {
  const { root, agentDir } = await fixture();
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const statuses: Array<string | undefined> = [];
  let branch: any[] = [];
  let activeTools = ["read", "edit"];
  let thinking = "off";

  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: (name: string, command: unknown) => commands.set(name, command),
    registerTool: (tool: any) => { tools.set(tool.name, tool); },
    getAllTools: () => ["read", "edit", ...tools.keys()].map((name) => ({ name })),
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => { activeTools = names; },
    setModel: async () => true,
    setThinkingLevel: (level: string) => { thinking = level; },
    getThinkingLevel: () => thinking,
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
  } as unknown as ExtensionAPI;

  const ctx = {
    cwd: root,
    hasUI: true,
    mode: "tui",
    isProjectTrusted: () => false,
    modelRegistry: { find: (provider: string, id: string) => ({ provider, id }) },
    sessionManager: { getBranch: () => branch },
    ui: {
      notify: () => undefined,
      select: async () => undefined,
      setStatus: (_key: string, value: string | undefined) => statuses.push(value),
    },
  } as unknown as ExtensionContext;

  createModeSwitchExtension({ getAgentDirectory: () => agentDir })(pi);
  await handlers.get("session_start")!({ reason: "startup" }, ctx);
  assert.deepEqual(activeTools, ["read", "mode_switch"]);
  assert.equal(statuses.at(-1), "mode:plan");
  assert.equal(entries.length, 0);

  await commands.get("mode").handler("code", ctx);
  assert.deepEqual(activeTools, ["read", "edit", "mode_switch"]);
  assert.deepEqual(entries.at(-1), { customType: "mode-switch-state", data: { mode: "code" } });

  const tool = tools.get("mode_switch");
  assert.deepEqual(tool.parameters.properties.mode.enum, ["plan", "code"]);
  const result = await tool.execute("call-1", { mode: "plan" }, undefined, undefined, ctx);
  assert.match(result.content[0].text, /Switched to mode "plan"/);
  assert.deepEqual(entries.at(-1), { customType: "mode-switch-state", data: { mode: "plan" } });

  branch = [{ type: "custom", customType: "mode-switch-state", data: { mode: "code" } }];
  await handlers.get("session_tree")!({}, ctx);
  assert.deepEqual(activeTools, ["read", "edit", "mode_switch"]);
  assert.equal(entries.length, 2);

  branch = [];
  await handlers.get("session_tree")!({}, ctx);
  assert.deepEqual(activeTools, ["read", "mode_switch"]);
  assert.equal(entries.length, 2);
});
```

- [ ] **Step 2: Add immediate context-switch and missing-config tests**

Append to `test/index.test.ts`:

```typescript
test("context uses the mode selected by the immediately preceding tool call", async () => {
  const { root, agentDir } = await fixture();
  const handlers = new Map<string, Function>();
  const tools = new Map<string, any>();
  let activeTools: string[] = [];
  let thinking = "off";
  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: () => undefined,
    registerTool: (tool: any) => tools.set(tool.name, tool),
    getAllTools: () => ["read", "edit", ...tools.keys()].map((name) => ({ name })),
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => { activeTools = names; },
    setModel: async () => true,
    setThinkingLevel: (level: string) => { thinking = level; },
    getThinkingLevel: () => thinking,
    appendEntry: () => undefined,
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: root,
    hasUI: false,
    mode: "json",
    isProjectTrusted: () => false,
    modelRegistry: { find: (provider: string, id: string) => ({ provider, id }) },
    sessionManager: { getBranch: () => [] },
    ui: { notify: () => undefined, setStatus: () => undefined },
  } as unknown as ExtensionContext;

  createModeSwitchExtension({ getAgentDirectory: () => agentDir, report: () => undefined })(pi);
  await handlers.get("session_start")!({ reason: "startup" }, ctx);
  await handlers.get("before_agent_start")!({ systemPromptOptions: { skills: [] } }, ctx);
  const first = await handlers.get("context")!({ messages: [] }, ctx);
  assert.match(first.messages.at(-1).content, /\[ACTIVE MODE: plan\]/);

  await tools.get("mode_switch").execute("call-2", { mode: "code" }, undefined, undefined, ctx);
  const second = await handlers.get("context")!({ messages: [] }, ctx);
  assert.match(second.messages.at(-1).content, /\[ACTIVE MODE: code\]/);
  assert.doesNotMatch(second.messages.at(-1).content, /\[ACTIVE MODE: plan\]/);
});

test("mode_switch remains registered without config and reports expected paths", async () => {
  const root = join(tmpdir(), `pi-mode-switch-empty-${process.pid}-${Date.now()}`);
  const handlers = new Map<string, Function>();
  const tools = new Map<string, any>();
  let activeTools = ["read"];
  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: () => undefined,
    registerTool: (tool: any) => tools.set(tool.name, tool),
    getAllTools: () => ["read", ...tools.keys()].map((name) => ({ name })),
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => { activeTools = names; },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: root,
    hasUI: false,
    mode: "json",
    isProjectTrusted: () => false,
    sessionManager: { getBranch: () => [] },
    ui: { notify: () => undefined, setStatus: () => undefined },
  } as unknown as ExtensionContext;

  createModeSwitchExtension({ getAgentDirectory: () => join(root, "agent"), report: () => undefined })(pi);
  await handlers.get("session_start")!({ reason: "startup" }, ctx);
  assert.ok(activeTools.includes("mode_switch"));
  await assert.rejects(
    () => tools.get("mode_switch").execute("call-3", { mode: "code" }, undefined, undefined, ctx),
    (error: unknown) => error instanceof Error && error.message.includes("modes.yaml") && error.message.includes(join(root, ".pi", "modes.yaml")),
  );
});
```

- [ ] **Step 3: Run integration tests and confirm they fail**

Run:

```bash
npm test -- test/index.test.ts
```

Expected: FAIL because `src/index.ts` does not exist.

- [ ] **Step 4: Implement the extension entry point**

Create `src/index.ts`:

```typescript
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadModeConfig } from "./config.ts";
import { MODE_SWITCH_TOOL, ModeController, type ModeRuntime } from "./mode-controller.ts";
import { SkillContextBuilder } from "./skills.ts";
import type { AppliedMode, LoadedModeConfig, ModeSwitchState, ThinkingLevel } from "./types.ts";

const STATE_TYPE = "mode-switch-state";
const CONTEXT_TYPE = "mode-switch-context";

export interface ModeSwitchExtensionDependencies {
  getAgentDirectory?: () => string;
  configDirName?: string;
  report?: (message: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function savedMode(ctx: ExtensionContext): string | undefined {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
    const data = entry.data as Partial<ModeSwitchState> | undefined;
    if (typeof data?.mode === "string") return data.mode;
  }
  return undefined;
}

export function createModeSwitchExtension(dependencies: ModeSwitchExtensionDependencies = {}) {
  return function modeSwitchExtension(pi: ExtensionAPI): void {
    let loaded: LoadedModeConfig | undefined;
    let controller: ModeController<unknown> | undefined;
    let active: AppliedMode | undefined;
    let currentContext: ExtensionContext | undefined;
    let toolRegistered = false;
    const skills = new SkillContextBuilder();
    const report = dependencies.report ?? ((message: string) => console.error(`[pi-mode-switch] ${message}`));

    function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "warning"): void {
      if (ctx.hasUI) ctx.ui.notify(message, level);
      else report(message);
    }

    function unavailableMessage(): string {
      const globalPath = loaded?.globalPath ?? "~/.pi/agent/modes.yaml";
      const projectPath = loaded?.projectPath ?? `<cwd>/${dependencies.configDirName ?? CONFIG_DIR_NAME}/modes.yaml`;
      return `No valid mode configuration. Create ${globalPath} or ${projectPath}, then run /reload.`;
    }

    function updateStatus(ctx: ExtensionContext): void {
      ctx.ui.setStatus("mode-switch", active ? `mode:${active.name}` : undefined);
    }

    async function activate(name: string, ctx: ExtensionContext, persist: boolean): Promise<AppliedMode> {
      currentContext = ctx;
      if (!controller) throw new Error(unavailableMessage());
      const applied = await controller.apply(name);
      active = applied;
      updateStatus(ctx);
      if (persist) pi.appendEntry<ModeSwitchState>(STATE_TYPE, { mode: name });
      return applied;
    }

    async function restore(ctx: ExtensionContext): Promise<void> {
      if (!loaded?.config || !controller) {
        active = undefined;
        updateStatus(ctx);
        return;
      }
      const stored = savedMode(ctx);
      const targets = [stored && loaded.config.modes[stored] ? stored : undefined, loaded.config.defaultMode]
        .filter((name, index, all): name is string => Boolean(name) && all.indexOf(name) === index);
      active = undefined;
      for (const target of targets) {
        try {
          await activate(target, ctx, false);
          return;
        } catch (error) {
          notify(ctx, `Could not activate mode "${target}": ${errorMessage(error)}`);
        }
      }
      updateStatus(ctx);
    }

    function registerModeTool(): void {
      if (toolRegistered) return;
      toolRegistered = true;
      const names = Object.keys(loaded?.config?.modes ?? {});
      const modeParameter = names.length > 0
        ? StringEnum(names as [string, ...string[]], { description: "Configured mode name" })
        : Type.String({ description: "Mode name; configuration is currently unavailable" });
      const profiles = names.map((name) => {
        const mode = loaded!.config!.modes[name];
        return `${name} (${mode.model}; tools: ${mode.tools.join(", ") || "none"}; skills: ${mode.skills.join(", ") || "none"})`;
      }).join("; ");

      pi.registerTool({
        name: MODE_SWITCH_TOOL,
        label: "Switch Mode",
        description: profiles ? `Switch to a configured agent mode. Available profiles: ${profiles}` : unavailableMessage(),
        promptSnippet: "Switch model, tools, instructions, and auto-loaded skills to another configured mode",
        promptGuidelines: ["Use mode_switch when another configured mode is a better fit; call it before doing work that needs the new mode."],
        parameters: Type.Object({ mode: modeParameter }),
        executionMode: "sequential",
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const applied = await activate(params.mode, ctx, true);
          return {
            content: [{
              type: "text",
              text: `Switched to mode "${applied.name}" (${applied.definition.model}); thinking: ${applied.effectiveThinkingLevel}; tools: ${applied.activeTools.join(", ")}; skills: ${applied.definition.skills.join(", ") || "none"}.`,
            }],
            details: {
              mode: applied.name,
              model: applied.definition.model,
              thinkingLevel: applied.effectiveThinkingLevel,
              tools: applied.activeTools,
              skills: applied.definition.skills,
            },
          };
        },
      });
    }

    pi.registerCommand("mode", {
      description: "Switch the active YAML-defined agent mode",
      getArgumentCompletions: (prefix) => {
        const matches = Object.entries(loaded?.config?.modes ?? {})
          .filter(([name]) => name.startsWith(prefix))
          .map(([name, mode]) => ({ value: name, label: name, description: mode.model }));
        return matches.length > 0 ? matches : null;
      },
      handler: async (args, ctx) => {
        currentContext = ctx;
        if (!loaded?.config) {
          notify(ctx, unavailableMessage(), "error");
          return;
        }
        let name = args.trim();
        if (!name) {
          if (!ctx.hasUI) {
            notify(ctx, `A mode name is required. Available: ${Object.keys(loaded.config.modes).join(", ")}`, "error");
            return;
          }
          name = await ctx.ui.select("Select mode", Object.keys(loaded.config.modes)) ?? "";
          if (!name) return;
        }
        try {
          await activate(name, ctx, true);
          notify(ctx, `Mode "${name}" activated`, "info");
        } catch (error) {
          notify(ctx, errorMessage(error), "error");
        }
      },
    });

    pi.on("session_start", async (_event, ctx) => {
      currentContext = ctx;
      loaded = await loadModeConfig({
        cwd: ctx.cwd,
        agentDir: (dependencies.getAgentDirectory ?? getAgentDir)(),
        configDirName: dependencies.configDirName ?? CONFIG_DIR_NAME,
        projectTrusted: ctx.isProjectTrusted(),
      });
      for (const diagnostic of loaded.diagnostics) notify(ctx, diagnostic.message);

      if (loaded.config) {
        const runtime: ModeRuntime<unknown> = {
          getAllToolNames: () => pi.getAllTools().map((tool) => tool.name),
          findModel: (provider, modelId) => currentContext?.modelRegistry.find(provider, modelId),
          setModel: (model) => pi.setModel(model as NonNullable<ExtensionContext["model"]>),
          setThinkingLevel: (level) => pi.setThinkingLevel(level),
          getThinkingLevel: () => pi.getThinkingLevel() as ThinkingLevel,
          setActiveTools: (names) => pi.setActiveTools(names),
        };
        controller = new ModeController(loaded.config, runtime);
      } else {
        controller = undefined;
      }

      registerModeTool();
      pi.setActiveTools([...new Set([...pi.getActiveTools(), MODE_SWITCH_TOOL])]);
      await restore(ctx);
    });

    pi.on("session_tree", async (_event, ctx) => {
      currentContext = ctx;
      await restore(ctx);
    });

    pi.on("before_agent_start", (event, ctx) => {
      currentContext = ctx;
      skills.setCatalogue((event.systemPromptOptions.skills ?? []) as Skill[]);
    });

    pi.on("context", async (event, ctx) => {
      currentContext = ctx;
      if (!active) return;
      const content = await skills.build(active.name, active.definition, (message) => notify(ctx, message));
      const modeMessage = {
        role: "custom",
        customType: CONTEXT_TYPE,
        content,
        display: false,
        timestamp: Date.now(),
      } as AgentMessage;
      return { messages: [...event.messages, modeMessage] };
    });
  };
}

export default createModeSwitchExtension();
```

- [ ] **Step 5: Run integration tests and type-check**

Run:

```bash
npm test -- test/index.test.ts
npm run typecheck
```

Expected: all integration tests PASS and type-check exits with code 0.

- [ ] **Step 6: Run the complete automated suite**

Run:

```bash
npm test
npm run typecheck
```

Expected: every test PASSes and type-check exits with code 0.

- [ ] **Step 7: Commit pi integration**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: expose YAML modes through pi"
```

## Task 7: Add the Example and User Documentation

**Files:**
- Create: `modes.example.yaml`
- Create: `README.md`
- Modify: `test/config.test.ts`

- [ ] **Step 1: Add a failing regression test for the shipped example**

Append to `test/config.test.ts`:

```typescript
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("modes.example.yaml stays valid", async () => {
  const path = fileURLToPath(new URL("../modes.example.yaml", import.meta.url));
  const parsed = parseModeConfig(await readFile(path, "utf8"), path);
  assert.equal(parsed.defaultMode, "plan");
  assert.deepEqual(Object.keys(parsed.modes), ["plan", "code"]);
});
```

Move all Node built-in imports to the top of the test file and keep a single import per module.

- [ ] **Step 2: Run the regression test and confirm the missing example**

Run:

```bash
npm test -- --test-name-pattern="modes.example.yaml"
```

Expected: FAIL with `ENOENT` for `modes.example.yaml`.

- [ ] **Step 3: Create the shipped example**

Create `modes.example.yaml`:

```yaml
version: 1
defaultMode: plan

modes:
  plan:
    model: openai-codex/gpt-5.4
    thinkingLevel: high
    tools: [read, grep, find, ls]
    skills: [brainstorming, writing-plans]
    instructions: |
      Analyze the request and repository, ask necessary questions, and produce an implementation plan.
      Do not modify project files while this mode is active.

  code:
    model: anthropic/claude-sonnet-4-6
    thinkingLevel: high
    tools: [read, bash, edit, write]
    skills: [test-driven-development, verification-before-completion]
    instructions: |
      Implement the approved change with focused edits, tests, and verification.
      Stop and explain unexpected complexity rather than bypassing it.
```

- [ ] **Step 4: Run the example regression test**

Run:

```bash
npm test -- --test-name-pattern="modes.example.yaml"
```

Expected: PASS.

- [ ] **Step 5: Write installation and behavior documentation**

Create `README.md` with these exact sections and commands:

````markdown
# pi-mode-switch

A pi extension that loads complete agent modes from YAML. A mode selects one model, an exact tool set, auto-loaded skills, and optional thinking/instructions.

> Pi packages execute with your full user permissions. Review this extension and every selected skill before installing it.

## Install

From this checkout:

```bash
npm install
pi install .
```

For one run without installing:

```bash
pi -e .
```

## Configure

Copy `modes.example.yaml` to either location:

- Global: `~/.pi/agent/modes.yaml`
- Project: `<project>/.pi/modes.yaml`

Project configuration is read only after pi trusts the project. Project modes replace global modes with the same name; other global modes remain. A project `defaultMode` overrides the global value.

Every mode requires `model`, `tools`, and `skills`. Use `provider/model-id`; the provider is the text before the first slash. `thinkingLevel` and `instructions` are optional.

```yaml
version: 1
defaultMode: plan
modes:
  plan:
    model: openai-codex/gpt-5.4
    thinkingLevel: high
    tools: [read, grep, find, ls]
    skills: [brainstorming, writing-plans]
    instructions: |
      Plan only. Do not modify files.
```

The configured model must already exist in pi and have working credentials. Tool and skill names must match resources discovered by pi. `mode_switch` is added automatically and cannot be removed by a mode profile.

After editing YAML, run `/reload`.

## Switch modes

- `/mode` opens a selector.
- `/mode code` switches directly.
- The agent can call `mode_switch({ mode: "code" })`.

New sessions use `defaultMode`. Explicit switches are stored as branch-aware custom session entries, so resume and tree navigation restore the branch's mode.

Selected skills are read in full and attached as ephemeral context before every model request. Other discovered skills remain available through pi's normal skill catalogue.

## Errors

Invalid files are reported with their path and field. An invalid project file does not disable a valid global file. Unknown models/tools reject a switch before tool or thinking state changes. Unknown or unreadable skills are warned and omitted while the rest of the mode remains active.

## Security boundary

Modes are workflow profiles, not sandboxes. An enabled `bash` tool can still modify files, and the agent is explicitly allowed to switch from a plan mode to a code mode. Use a separate permission or sandbox extension when enforcement is required.

## Develop

```bash
npm test
npm run typecheck
npm pack --dry-run
```
````

- [ ] **Step 6: Run tests and type-check**

Run:

```bash
npm test
npm run typecheck
```

Expected: every test PASSes and type-check exits with code 0.

- [ ] **Step 7: Commit docs and example**

```bash
git add README.md modes.example.yaml test/config.test.ts
git commit -m "docs: explain YAML mode configuration"
```

## Task 8: Verify the Package Without a Paid Model Request

**Files:**
- Verify: all package files

- [ ] **Step 1: Check repository cleanliness and whitespace**

Run:

```bash
git status --short
git diff --check HEAD
```

Expected: `git status --short` prints nothing and `git diff --check HEAD` prints nothing.

- [ ] **Step 2: Run the complete test suite from a clean process**

Run:

```bash
npm test
```

Expected: all config, controller, skill, integration, and example tests PASS with zero failures.

- [ ] **Step 3: Run strict type-checking**

Run:

```bash
npm run typecheck
```

Expected: `tsc --noEmit` exits with code 0 and prints no diagnostics.

- [ ] **Step 4: Inspect the npm/pi package payload**

Run:

```bash
npm pack --dry-run
```

Expected: the payload includes `package.json`, `README.md`, `modes.example.yaml`, and all five `src/*.ts` files; it excludes `test/`, `docs/`, and local configuration.

- [ ] **Step 5: Smoke-load the extension through the installed pi CLI**

Run:

```bash
pi -e . --list-models > /dev/null
```

Expected: exit code 0 with no module-resolution, manifest, YAML-import, or extension-factory error. This command lists the local model catalogue and does not send a model request.

- [ ] **Step 6: Record final evidence**

Run:

```bash
git log --oneline --decorate -8
git status --short --branch
```

Expected: the feature commits are visible and the branch has no uncommitted files.
