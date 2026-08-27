# Skill-Triggered Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically activate and persist a configured mode when a user invokes a Pi skill command or the agent reads that discovered skill's `SKILL.md`.

**Architecture:** Add an optional per-mode `triggerSkills` list with deterministic merged-config validation. Build one skill-to-mode lookup in the extension, intercept Pi's `input` and `tool_call` events, and route both through the existing atomic `activate()` path. Extend the existing skill catalogue helper for exact path matching and the existing mode editor for trigger selection.

**Tech Stack:** TypeScript ESM, Pi extension API 0.84.x, TypeBox, `yaml`, Node test runner through `tsx`, `node:assert/strict`.

**Design reference:** `docs/superpowers/specs/2026-08-27-skill-triggered-modes-design.md`

---

## File Map

| Path | Responsibility |
|---|---|
| `src/types.ts` | Add normalized `triggerSkills` mode data. |
| `src/config.ts` | Parse trigger lists and reject ambiguous skill-to-mode assignments in source and merged configs. |
| `src/skills.ts` | Resolve a `read` path to the exact discovered skill file. |
| `src/index.ts` | Build trigger lookup, intercept explicit skill commands and skill-file reads, switch/persist, warn, and block failures. |
| `src/mode-editor.ts` | Round-trip and edit `triggerSkills`. |
| `test/config.test.ts` | Cover parsing, ambiguity, merge fallback, and the shipped example. |
| `test/skills.test.ts` | Cover exact absolute/relative/`@` path matching and non-matches. |
| `test/index.test.ts` | Cover explicit and model-triggered activation, no-ops, persistence, failures, warnings, and next-turn context. |
| `test/mode-editor.test.ts` | Cover trigger serialization and omission. |
| `modes.example.yaml` | Show representative trigger assignments. |
| `README.md` | Document semantics, timing, persistence, errors, and limitations. |

No new dependency or source module is required.

## Task 1: Parse and Validate Trigger Assignments

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] **Step 1: Add failing parser and ambiguity tests**

Add these tests after the existing allow/deny parser tests in `test/config.test.ts`:

```typescript
test("parseModeConfig normalizes triggerSkills", () => {
  const parsed = parseModeConfig(
    `
version: 1
defaultMode: plan
modes:
  plan:
    model: openai/gpt
    tools: [read]
    skills: []
    triggerSkills: [brainstorming, brainstorming, writing-plans]
`,
    "/config/modes.yaml",
  );

  assert.deepEqual(parsed.modes.plan.triggerSkills, ["brainstorming", "writing-plans"]);
});

test("parseModeConfig rejects one trigger skill assigned to multiple modes", () => {
  assert.throws(
    () => parseModeConfig(
      `
version: 1
defaultMode: plan
modes:
  plan:
    model: openai/plan
    tools: [read]
    skills: []
    triggerSkills: [brainstorming]
  code:
    model: openai/code
    tools: [read, edit]
    skills: []
    triggerSkills: [brainstorming]
`,
      "/config/modes.yaml",
    ),
    (error: unknown) =>
      error instanceof ConfigValidationError &&
      error.message.includes('trigger skill "brainstorming" is already assigned to mode "plan"'),
  );
});

test("parseModeConfig rejects malformed triggerSkills", () => {
  assert.throws(
    () => parseModeConfig(VALID.replace("    skills:", "    triggerSkills: read\n    skills:"), "/config/modes.yaml"),
    (error: unknown) => error instanceof ConfigValidationError && error.message.includes("triggerSkills must be an array"),
  );
  assert.throws(
    () => parseModeConfig(VALID.replace("    skills:", "    triggerSkills: [\"\"]\n    skills:"), "/config/modes.yaml"),
    (error: unknown) =>
      error instanceof ConfigValidationError &&
      error.message.includes("triggerSkills entries must be non-empty strings"),
  );
});

test("mergeModeConfigs keeps the replacement mode's triggerSkills", () => {
  const global = parseModeConfig(
    GLOBAL.replace("    model: anthropic/old-code", "    triggerSkills: [old-code-skill]\n    model: anthropic/old-code"),
    "/global/modes.yaml",
  );
  const project = parseModeConfig(
    PROJECT.replace("    model: anthropic/new-code", "    triggerSkills: [new-code-skill]\n    model: anthropic/new-code"),
    "/project/modes.yaml",
  );

  const merged = mergeModeConfigs(global, project);

  assert.deepEqual(merged.modes.code.triggerSkills, ["new-code-skill"]);
});
```

- [ ] **Step 2: Run the parser tests and verify red**

Run:

```bash
npm test -- --test-name-pattern="triggerSkills|trigger skill"
```

Expected: FAIL because `triggerSkills` is currently an unknown mode field.

- [ ] **Step 3: Add the normalized type and parser field**

Add the optional property in `src/types.ts`:

```typescript
export interface ModeDefinition {
  model: string;
  provider: string;
  modelId: string;
  tools?: string[];
  excludeTools?: string[];
  skills?: string[];
  excludeSkills?: string[];
  triggerSkills?: string[];
  thinkingLevel?: ThinkingLevel;
  instructions?: string;
}
```

Add `"triggerSkills"` to `MODE_FIELDS` in `src/config.ts`. In `parseMode`, parse and return it alongside the existing skill fields:

```typescript
const skills = optionalStringList(value.skills, filePath, `${field}.skills`);
const excludeSkills = optionalStringList(value.excludeSkills, filePath, `${field}.excludeSkills`);
const triggerSkills = optionalStringList(value.triggerSkills, filePath, `${field}.triggerSkills`);
```

```typescript
...(skills !== undefined ? { skills } : {}),
...(excludeSkills !== undefined ? { excludeSkills } : {}),
...(triggerSkills !== undefined ? { triggerSkills } : {}),
```

- [ ] **Step 4: Validate deterministic trigger ownership**

Add this helper after `optionalStringList` in `src/config.ts`:

```typescript
function validateTriggerAssignments(
  modes: Record<string, ModeDefinition>,
  filePath: string,
): void {
  const owners = new Map<string, string>();
  for (const [modeName, mode] of Object.entries(modes)) {
    for (const skillName of mode.triggerSkills ?? []) {
      const existing = owners.get(skillName);
      if (existing && existing !== modeName) {
        fail(
          filePath,
          `modes.${modeName}.triggerSkills`,
          `trigger skill "${skillName}" is already assigned to mode "${existing}"`,
        );
      }
      owners.set(skillName, modeName);
    }
  }
}
```

Call it after the mode loop in `parseModeConfig`:

```typescript
validateTriggerAssignments(modes, filePath);
return { version: 1, ...(defaultMode ? { defaultMode } : {}), modes, sourcePath: filePath };
```

Call it after `diagnosticPath` is computed in `mergeModeConfigs`:

```typescript
validateTriggerAssignments(modes, diagnosticPath);
```

This second call catches conflicts created only by combining otherwise valid global and project sources.

- [ ] **Step 5: Run parser tests and type-check**

Run:

```bash
npm test -- --test-name-pattern="triggerSkills|trigger skill"
npm run typecheck
```

Expected: all selected tests PASS and type-check exits 0.

- [ ] **Step 6: Add a failing merged-config fallback test**

Append to `test/config.test.ts`:

```typescript
test("loadModeConfig ignores a project trigger conflict and retains global config", async () => {
  const globalPath = join("/agent", "modes.yaml");
  const projectPath = join("/repo", ".pi", "modes.yaml");
  const globalWithTrigger = GLOBAL.replace("    skills: []", "    skills: []\n    triggerSkills: [brainstorming]");
  const projectWithConflict = PROJECT.replace(
    "    skills: [test-driven-development]",
    "    skills: [test-driven-development]\n    triggerSkills: [brainstorming]",
  );

  const loaded = await loadModeConfig({
    cwd: "/repo",
    agentDir: "/agent",
    configDirName: ".pi",
    projectTrusted: true,
    readText: async (path) => {
      if (path === globalPath) return globalWithTrigger;
      if (path === projectPath) return projectWithConflict;
      throw missingFile(path);
    },
  });

  assert.equal(loaded.config?.defaultMode, "plan");
  assert.deepEqual(loaded.config?.modes.plan.triggerSkills, ["brainstorming"]);
  assert.equal(loaded.config?.modes.code.model, "anthropic/old-code");
  assert.ok(loaded.diagnostics.some((diagnostic) => diagnostic.message.includes("already assigned")));
});
```

- [ ] **Step 7: Run the fallback test and all config tests**

Run:

```bash
npm test -- --test-name-pattern="project trigger conflict"
npm test -- test/config.test.ts
```

Expected: both commands PASS.

- [ ] **Step 8: Commit config support**

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat: configure skill-triggered modes"
```

## Task 2: Resolve Exact Discovered Skill Paths

**Files:**
- Modify: `src/skills.ts`
- Test: `test/skills.test.ts`

- [ ] **Step 1: Add failing path-resolution tests**

Add imports to `test/skills.test.ts`:

```typescript
import { join, relative, resolve } from "node:path";
```

Append:

```typescript
test("SkillContextBuilder resolves only exact discovered skill files", () => {
  const cwd = resolve("skill-path-fixture");
  const alphaPath = join(cwd, "skills", "alpha", "SKILL.md");
  const builder = new SkillContextBuilder();
  builder.setCatalogue([skill("alpha", alphaPath)]);

  assert.equal(builder.skillNameForPath(alphaPath, cwd), "alpha");
  assert.equal(builder.skillNameForPath(relative(cwd, alphaPath), cwd), "alpha");
  assert.equal(builder.skillNameForPath(`@${relative(cwd, alphaPath)}`, cwd), "alpha");
  assert.equal(builder.skillNameForPath(join(cwd, "skills", "alpha", "references", "guide.md"), cwd), undefined);
  assert.equal(builder.skillNameForPath(join(cwd, "skills", "beta", "SKILL.md"), cwd), undefined);
});
```

- [ ] **Step 2: Run the skill test and verify red**

Run:

```bash
npm test -- --test-name-pattern="exact discovered skill files"
```

Expected: FAIL because `skillNameForPath` does not exist.

- [ ] **Step 3: Add normalized path indexing**

At the top of `src/skills.ts`, add:

```typescript
import { normalize, resolve } from "node:path";
```

Add this helper after `unique`:

```typescript
function pathKey(path: string, cwd: string): string {
  const withoutMarker = path.startsWith("@") ? path.slice(1) : path;
  const normalized = normalize(resolve(cwd, withoutMarker));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
```

Add a path map to `SkillContextBuilder`, rebuild it with the catalogue, and expose exact lookup:

```typescript
private catalogue = new Map<string, Skill>();
private catalogueByPath = new Map<string, string>();
private contentCache = new Map<string, Promise<string | undefined>>();
private warned = new Set<string>();
```

```typescript
setCatalogue(skills: Skill[]): void {
  this.catalogue = new Map(skills.map((skill) => [skill.name, skill]));
  this.catalogueByPath = new Map(
    skills.map((skill) => [pathKey(skill.filePath, skill.baseDir), skill.name]),
  );
}

skillNameForPath(path: string, cwd: string): string | undefined {
  return this.catalogueByPath.get(pathKey(path, cwd));
}
```

`skill.filePath` is expected to be absolute; passing `skill.baseDir` keeps an already absolute path unchanged and provides a sensible base for any relative test double.

- [ ] **Step 4: Run all skill tests and type-check**

Run:

```bash
npm test -- test/skills.test.ts
npm run typecheck
```

Expected: all skill tests PASS and type-check exits 0.

- [ ] **Step 5: Commit exact path lookup**

```bash
git add src/skills.ts test/skills.test.ts
git commit -m "feat: identify discovered skill reads"
```

## Task 3: Trigger Modes from Explicit Skill Commands

**Files:**
- Modify: `src/index.ts`
- Modify: `test/index.test.ts`

- [ ] **Step 1: Give the integration fixture trigger assignments**

In the YAML written by `fixture()` in `test/index.test.ts`, add:

```yaml
  plan:
    model: provider/plan-model
    thinkingLevel: high
    tools: [read]
    skills: []
    triggerSkills: [writing-plans]
    instructions: Plan only.
  code:
    model: provider/code-model
    thinkingLevel: medium
    tools: [read, edit]
    skills: []
    triggerSkills: [brainstorming, missing-trigger]
    instructions: Code now.
```

- [ ] **Step 2: Add a focused trigger harness**

Add this helper after `fixture()` in `test/index.test.ts`:

```typescript
async function triggerHarness(options: { failCode?: boolean } = {}) {
  const { root, agentDir } = await fixture();
  const handlers = new Map<string, Function>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const reports: string[] = [];
  let activeTools = ["read", "edit"];
  let thinking = "off";

  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
    registerCommand: () => undefined,
    registerTool: () => undefined,
    getCommands: () => [
      { name: "skill:brainstorming", source: "skill", sourceInfo: {} },
      { name: "skill:writing-plans", source: "skill", sourceInfo: {} },
      { name: "skill:not-a-trigger", source: "skill", sourceInfo: {} },
    ],
    getAllTools: () => ["read", "edit", "mode_switch"].map((name) => ({ name })),
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => { activeTools = names; },
    setModel: async (model: any) => !(options.failCode && model.id === "code-model"),
    setThinkingLevel: (level: string) => { thinking = level; },
    getThinkingLevel: () => thinking,
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
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

  createModeSwitchExtension({
    getAgentDirectory: () => agentDir,
    report: (message) => reports.push(message),
  })(pi);
  await handlers.get("session_start")!({ reason: "startup" }, ctx);

  return {
    root,
    handlers,
    entries,
    reports,
    ctx,
    get activeTools() { return activeTools; },
  };
}
```

- [ ] **Step 3: Add failing explicit-trigger tests**

Append to `test/index.test.ts`:

```typescript
test("explicit skill commands activate and persist their target mode", async () => {
  const harness = await triggerHarness();
  const event = { text: "/skill:brainstorming focus on behavior", source: "interactive" };

  const result = await harness.handlers.get("input")!(event, harness.ctx);

  assert.deepEqual(result, { action: "continue" });
  assert.equal(event.text, "/skill:brainstorming focus on behavior");
  assert.deepEqual(harness.activeTools, ["read", "edit", "mode_switch"]);
  assert.deepEqual(harness.entries, [
    { customType: "mode-switch-state", data: { mode: "code" } },
  ]);
});

test("explicit skill triggers ignore unavailable and unmapped skills and skip an already-active mode", async () => {
  const harness = await triggerHarness();

  const unavailable = await harness.handlers.get("input")!(
    { text: "/skill:missing-trigger", source: "interactive" },
    harness.ctx,
  );
  const unmapped = await harness.handlers.get("input")!(
    { text: "/skill:not-a-trigger", source: "interactive" },
    harness.ctx,
  );
  const alreadyActive = await harness.handlers.get("input")!(
    { text: "/skill:writing-plans", source: "interactive" },
    harness.ctx,
  );

  assert.deepEqual(unavailable, { action: "continue" });
  assert.deepEqual(unmapped, { action: "continue" });
  assert.deepEqual(alreadyActive, { action: "continue" });
  assert.deepEqual(harness.entries, []);
});

test("explicit skill trigger failure consumes the command", async () => {
  const harness = await triggerHarness({ failCode: true });

  const result = await harness.handlers.get("input")!(
    { text: "/skill:brainstorming", source: "interactive" },
    harness.ctx,
  );

  assert.deepEqual(result, { action: "handled" });
  assert.deepEqual(harness.activeTools, ["read", "mode_switch"]);
  assert.deepEqual(harness.entries, []);
  assert.ok(harness.reports.some((message) => message.includes("credentials are unavailable")));
});
```

- [ ] **Step 4: Run the explicit-trigger tests and verify red**

Run:

```bash
npm test -- --test-name-pattern="explicit skill"
```

Expected: FAIL because no `input` handler is registered.

- [ ] **Step 5: Build the trigger lookup and shared activation helper**

In `src/index.ts`, add extension state next to `active`:

```typescript
let active: AppliedMode | undefined;
let triggerModes = new Map<string, string>();
```

Add this helper after `activate`:

```typescript
async function activateForSkill(skillName: string, ctx: ExtensionContext): Promise<boolean> {
  const modeName = triggerModes.get(skillName);
  if (!modeName || active?.name === modeName) return false;
  await activate(modeName, ctx, true);
  notify(ctx, `Skill "${skillName}" activated mode "${modeName}"`, "info");
  return true;
}
```

After a valid config is loaded in `session_start`, build the unique lookup before constructing the controller:

```typescript
triggerModes = new Map(
  Object.entries(loaded.config.modes).flatMap(([modeName, mode]) =>
    (mode.triggerSkills ?? []).map((skillName) => [skillName, modeName] as const),
  ),
);
```

In the no-config branch, clear stale state:

```typescript
} else {
  controller = undefined;
  triggerModes = new Map();
}
```

- [ ] **Step 6: Register pre-expansion input interception**

Add this handler before `session_start` registration in `src/index.ts`:

```typescript
pi.on("input", async (event, ctx) => {
  const match = /^\/skill:([^\s]+)(?:\s|$)/.exec(event.text);
  const skillName = match?.[1];
  if (!skillName || !triggerModes.has(skillName)) return { action: "continue" };

  const isSkillCommand = pi.getCommands().some(
    (command) => command.source === "skill" && command.name === `skill:${skillName}`,
  );
  if (!isSkillCommand) return { action: "continue" };

  try {
    await activateForSkill(skillName, ctx);
    return { action: "continue" };
  } catch (error) {
    notify(ctx, `Could not activate mode for skill "${skillName}": ${errorMessage(error)}`, "error");
    return { action: "handled" };
  }
});
```

This returns the original input unchanged for Pi's normal skill expansion.

- [ ] **Step 7: Run explicit tests, full integration tests, and type-check**

Run:

```bash
npm test -- --test-name-pattern="explicit skill"
npm test -- test/index.test.ts
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 8: Commit explicit triggers**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: switch modes for skill commands"
```

## Task 4: Trigger Modes from Agent Skill Reads

**Files:**
- Modify: `src/index.ts`
- Modify: `test/index.test.ts`

- [ ] **Step 1: Import path and skill metadata helpers in the integration test**

Update the path import in `test/index.test.ts`:

```typescript
import { dirname, join, relative } from "node:path";
```

Add this helper after `triggerHarness`:

```typescript
function discoveredSkill(name: string, filePath: string) {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: dirname(filePath),
    sourceInfo: {},
    disableModelInvocation: false,
  };
}
```

- [ ] **Step 2: Add failing read-trigger and warning tests**

Append:

```typescript
test("reading a discovered skill activates its mode before the next context", async () => {
  const harness = await triggerHarness();
  const skillPath = join(harness.root, "skills", "brainstorming", "SKILL.md");
  await harness.handlers.get("before_agent_start")!(
    { systemPromptOptions: { skills: [discoveredSkill("brainstorming", skillPath)] } },
    harness.ctx,
  );

  const result = await harness.handlers.get("tool_call")!(
    { toolName: "read", toolCallId: "read-1", input: { path: relative(harness.root, skillPath) } },
    harness.ctx,
  );
  const context = await harness.handlers.get("context")!({ messages: [] }, harness.ctx);

  assert.equal(result, undefined);
  assert.deepEqual(harness.activeTools, ["read", "edit", "mode_switch"]);
  assert.deepEqual(harness.entries, [
    { customType: "mode-switch-state", data: { mode: "code" } },
  ]);
  assert.match(context.messages.at(-1).content, /\[ACTIVE MODE: code\]/);
});

test("ordinary and skill reference reads do not trigger modes", async () => {
  const harness = await triggerHarness();
  const skillPath = join(harness.root, "skills", "brainstorming", "SKILL.md");
  await harness.handlers.get("before_agent_start")!(
    { systemPromptOptions: { skills: [discoveredSkill("brainstorming", skillPath)] } },
    harness.ctx,
  );

  const ordinary = await harness.handlers.get("tool_call")!(
    { toolName: "read", toolCallId: "read-2", input: { path: "README.md" } },
    harness.ctx,
  );
  const reference = await harness.handlers.get("tool_call")!(
    { toolName: "read", toolCallId: "read-3", input: { path: join(dirname(skillPath), "references", "guide.md") } },
    harness.ctx,
  );

  assert.equal(ordinary, undefined);
  assert.equal(reference, undefined);
  assert.deepEqual(harness.entries, []);
});

test("a failed skill-read trigger blocks the read", async () => {
  const harness = await triggerHarness({ failCode: true });
  const skillPath = join(harness.root, "skills", "brainstorming", "SKILL.md");
  await harness.handlers.get("before_agent_start")!(
    { systemPromptOptions: { skills: [discoveredSkill("brainstorming", skillPath)] } },
    harness.ctx,
  );

  const result = await harness.handlers.get("tool_call")!(
    { toolName: "read", toolCallId: "read-4", input: { path: `@${skillPath}` } },
    harness.ctx,
  );

  assert.equal(result.block, true);
  assert.match(result.reason, /credentials are unavailable/);
  assert.deepEqual(harness.entries, []);
});

test("unknown configured trigger skills warn once after discovery", async () => {
  const harness = await triggerHarness();
  const event = { systemPromptOptions: { skills: [] } };

  await harness.handlers.get("before_agent_start")!(event, harness.ctx);
  await harness.handlers.get("before_agent_start")!(event, harness.ctx);

  assert.equal(harness.reports.filter((message) => message.includes("missing-trigger")).length, 1);
});
```

- [ ] **Step 3: Run read-trigger tests and verify red**

Run:

```bash
npm test -- --test-name-pattern="discovered skill|skill reference|skill-read|configured trigger"
```

Expected: FAIL because no `tool_call` handler or trigger warning exists.

- [ ] **Step 4: Import Pi's read-event type guard**

Add `isToolCallEventType` to the existing coding-agent import in `src/index.ts`:

```typescript
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type Skill,
} from "@earendil-works/pi-coding-agent";
```

Add warning state beside `discoveredSkillNames`:

```typescript
let discoveredSkillNames: string[] = [];
const warnedTriggerSkills = new Set<string>();
```

- [ ] **Step 5: Warn once for trigger names absent from discovery**

Extend the existing `before_agent_start` handler after `discoveredSkillNames` is assigned:

```typescript
const discovered = new Set(discoveredSkillNames);
for (const [skillName, modeName] of triggerModes) {
  if (discovered.has(skillName) || warnedTriggerSkills.has(skillName)) continue;
  warnedTriggerSkills.add(skillName);
  notify(ctx, `Mode "${modeName}": unknown trigger skill "${skillName}"`);
}
```

- [ ] **Step 6: Intercept exact discovered skill reads**

Add this handler after `before_agent_start` and before `context`:

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (!isToolCallEventType("read", event)) return;
  const skillName = skills.skillNameForPath(event.input.path, ctx.cwd);
  if (!skillName || !triggerModes.has(skillName)) return;

  try {
    await activateForSkill(skillName, ctx);
  } catch (error) {
    const reason = `Could not activate mode for skill "${skillName}": ${errorMessage(error)}`;
    notify(ctx, reason, "error");
    return { block: true, reason };
  }
});
```

- [ ] **Step 7: Run integration tests and type-check**

Run:

```bash
npm test -- --test-name-pattern="discovered skill|skill reference|skill-read|configured trigger"
npm test -- test/index.test.ts
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 8: Commit model-triggered activation**

```bash
git add src/index.ts test/index.test.ts
git commit -m "feat: switch modes for discovered skill reads"
```

## Task 5: Add Trigger Skills to the Mode Editor

**Files:**
- Modify: `src/mode-editor.ts`
- Test: `test/mode-editor.test.ts`

- [ ] **Step 1: Add failing editor round-trip tests**

Append to `test/mode-editor.test.ts`:

```typescript
test("mode editor preserves trigger skill selections", () => {
  const serialized = serializeModeConfig({
    version: 1,
    defaultMode: "code",
    sourcePath: "/project/.pi/modes.yaml",
    modes: {
      code: {
        model: "openai-codex/gpt-5.6-luna",
        provider: "openai-codex",
        modelId: "gpt-5.6-luna",
        tools: ["read", "write"],
        skills: ["test-driven-development"],
        triggerSkills: ["test-driven-development", "verification-before-completion"],
      },
    },
  });

  const parsed = parseModeConfig(serialized, "/project/.pi/modes.yaml");
  assert.deepEqual(parsed.modes.code.triggerSkills, [
    "test-driven-development",
    "verification-before-completion",
  ]);
});

test("mode editor does not invent triggerSkills", () => {
  const serialized = serializeModeConfig({
    version: 1,
    sourcePath: "/project/.pi/modes.yaml",
    modes: {
      code: {
        model: "openai/gpt",
        provider: "openai",
        modelId: "gpt",
        tools: [],
        skills: [],
      },
    },
  });

  assert.doesNotMatch(serialized, /triggerSkills:/);
});
```

- [ ] **Step 2: Run editor tests and verify red**

Run:

```bash
npm test -- --test-name-pattern="trigger skill selections|invent triggerSkills"
```

Expected: the preservation test FAILS because serialization omits `triggerSkills`.

- [ ] **Step 3: Round-trip trigger data**

In `serializeModeConfig`, add after `excludeSkills`:

```typescript
...(mode.triggerSkills !== undefined ? { triggerSkills: [...mode.triggerSkills] } : {}),
```

In `cloneMode`, add:

```typescript
...(mode.triggerSkills !== undefined ? { triggerSkills: [...mode.triggerSkills] } : {}),
```

Update each mode's selector description to expose the trigger count:

```typescript
description: `${mode.model} · ${mode.excludeTools !== undefined ? "all tools except denied" : `${mode.tools?.length ?? 0} tools`} · ${mode.excludeSkills !== undefined ? "all skills except denied" : `${mode.skills?.length ?? 0} skills`} · ${mode.triggerSkills?.length ?? 0} triggers`,
```

- [ ] **Step 4: Add the Trigger skills multi-select**

Insert this `SettingItem` after `bannedSkills` and before `instructions` in `modeSettings`:

```typescript
{
  id: "triggerSkills",
  label: "Trigger skills",
  description: "Skills that automatically activate this mode",
  currentValue: displayList(working.triggerSkills ?? []),
  submenu: (_currentValue, submenuDone) =>
    new MultiSelectSubmenu(
      tui,
      theme,
      "Trigger skills",
      "Select skills that switch to this mode when invoked or read.",
      skillNames,
      working.triggerSkills ?? [],
      submenuDone,
      (values) => {
        if (values.length > 0) working.triggerSkills = values;
        else delete working.triggerSkills;
      },
    ),
},
```

No switch case is needed because `MultiSelectSubmenu` updates `working` through its callback.

- [ ] **Step 5: Run editor/config tests and type-check**

Run:

```bash
npm test -- test/mode-editor.test.ts
npm test -- test/config.test.ts
npm run typecheck
```

Expected: all commands PASS.

- [ ] **Step 6: Commit editor support**

```bash
git add src/mode-editor.ts test/mode-editor.test.ts
git commit -m "feat: edit skill triggers in mode profiles"
```

## Task 6: Document and Ship Trigger Examples

**Files:**
- Modify: `modes.example.yaml`
- Modify: `README.md`
- Modify: `test/config.test.ts`

- [ ] **Step 1: Strengthen the shipped-example regression test**

Extend `modes.example.yaml stays valid` in `test/config.test.ts`:

```typescript
test("modes.example.yaml stays valid", async () => {
  const path = fileURLToPath(new URL("../modes.example.yaml", import.meta.url));
  const parsed = parseModeConfig(await readFile(path, "utf8"), path);
  assert.equal(parsed.defaultMode, "plan");
  assert.deepEqual(Object.keys(parsed.modes), ["plan", "code"]);
  assert.deepEqual(parsed.modes.plan.triggerSkills, ["brainstorming", "writing-plans"]);
  assert.deepEqual(parsed.modes.code.triggerSkills, [
    "test-driven-development",
    "verification-before-completion",
  ]);
});
```

- [ ] **Step 2: Run the example test and verify red**

Run:

```bash
npm test -- --test-name-pattern="modes.example.yaml"
```

Expected: FAIL because the example has no trigger lists.

- [ ] **Step 3: Add triggers to the shipped example**

Add to the `plan` mode in `modes.example.yaml`:

```yaml
    triggerSkills: [brainstorming, writing-plans]
```

Add to the `code` mode:

```yaml
    triggerSkills: [test-driven-development, verification-before-completion]
```

Keep each field adjacent to the corresponding `skills` entry.

- [ ] **Step 4: Document configuration and runtime semantics**

In README's configuration section, update the field description to say:

```markdown
Every mode requires `model` and either `tools` or `excludeTools`, plus either `skills` or `excludeSkills`. `triggerSkills` is optional and maps explicit or agent-loaded skills to that mode. A skill can trigger only one mode. Use `provider/model-id`; the provider is the text before the first slash. `thinkingLevel` and `instructions` are optional. Allow and deny fields may coexist; deny fields take precedence and automatically include newly discovered resources unless banned.
```

Add `triggerSkills` to the inline YAML example:

```yaml
    skills: [brainstorming, writing-plans]
    triggerSkills: [brainstorming, writing-plans]
```

Add this subsection after **Switch modes**:

```markdown
## Skill-triggered modes

A mode's optional `triggerSkills` list is separate from `skills` and `excludeSkills`, which only control auto-loaded context. A mapped skill switches modes in either case:

- The user invokes `/skill:name`.
- The agent reads the exact discovered `SKILL.md` for that skill.

The switch happens before the explicit skill is expanded or the discovered skill file is read. Successful switches use the same branch-aware persistence as `/mode`; if the target is already active, no duplicate state is stored. If activation fails, the explicit command or skill-file read is blocked instead of running in the previous mode. Reads of skill reference files and assets do not trigger a switch.
```

Extend the editor bullet under **Switch modes** to include `Trigger skills`.

Extend **Security boundary** with:

```markdown
A skill-triggered switch does not cancel sibling tool calls already emitted in the same assistant message.
```

- [ ] **Step 5: Run docs regression and complete automated suite**

Run:

```bash
npm test -- --test-name-pattern="modes.example.yaml"
npm test
npm run typecheck
```

Expected: all tests PASS and type-check exits 0.

- [ ] **Step 6: Commit docs and example**

```bash
git add README.md modes.example.yaml test/config.test.ts
git commit -m "docs: explain skill-triggered modes"
```

## Task 7: Verify Package and Runtime Loading

**Files:**
- Verify: all changed package files

- [ ] **Step 1: Check repository state and whitespace**

Run:

```bash
git status --short --branch
git diff --check HEAD
```

Expected: the branch is ahead only by committed feature work, `git status --short` shows no changed files, and `git diff --check HEAD` prints nothing.

- [ ] **Step 2: Run the full test suite from a clean process**

Run:

```bash
npm test
```

Expected: every config, extension, controller, editor, and skill test PASSes with zero failures.

- [ ] **Step 3: Run strict type-checking**

Run:

```bash
npm run typecheck
```

Expected: `tsc --noEmit` exits 0 with no diagnostics.

- [ ] **Step 4: Inspect the npm/pi package payload**

Run:

```bash
npm pack --dry-run
```

Expected: payload includes `package.json`, `README.md`, `modes.example.yaml`, and all `src/*.ts`; it excludes `test/`, `docs/`, and `.pi/`.

- [ ] **Step 5: Smoke-load the extension without a model request**

Run:

```bash
pi -e . --list-models > /dev/null
```

Expected: exit 0 with no extension factory, manifest, import, or YAML errors.

- [ ] **Step 6: Review final commit and status evidence**

Run:

```bash
git log --oneline --decorate -10
git status --short --branch
```

Expected: the design commit plus focused config, path lookup, explicit trigger, read trigger, editor, and docs commits are visible; the worktree is clean.
