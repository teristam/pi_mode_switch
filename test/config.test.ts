import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ConfigValidationError, loadModeConfig, mergeModeConfigs, parseModeConfig } from "../src/config.ts";

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

const invalidCases = [
  ["unsupported version", VALID.replace("version: 1", "version: 2"), "version must be 1"],
  ["unknown root field", `${VALID}\nextra: true\n`, "unknown field \"extra\""],
  ["unknown mode field", VALID.replace("    tools:", "    extra: true\n    tools:"), "unknown field \"extra\""],
  ["missing model", VALID.replace("    model: openrouter/anthropic/claude-sonnet-4\n", ""), "model must be a string"],
  ["bad model", VALID.replace("openrouter/anthropic/claude-sonnet-4", "no-slash"), "model must use provider/model-id"],
  ["bad thinking", VALID.replace("thinkingLevel: high", "thinkingLevel: huge"), "thinkingLevel must be one of"],
  ["bad tools", VALID.replace("tools: [read, read, grep]", "tools: read"), "tools must be an array"],
  ["bad skills", VALID.replace("skills: [brainstorming, brainstorming]", "skills: [\"\"]"), "skills entries must be non-empty strings"],
] as const;

for (const [name, source, message] of invalidCases) {
  test(`parseModeConfig rejects ${name}`, () => {
    assert.throws(
      () => parseModeConfig(source, "/config/modes.yaml"),
      (error: unknown) => error instanceof ConfigValidationError && error.message.includes(message),
    );
  });
}

test("parseModeConfig accepts combined allow and deny lists", () => {
  const parsed = parseModeConfig(
    `
version: 1
defaultMode: code
modes:
  code:
    model: openai/gpt
    tools: [read, write]
    excludeTools: [write]
    skills: [test-driven-development]
    excludeSkills: [officecli]
`,
    "/config/modes.yaml",
  );

  assert.deepEqual(parsed.modes.code.tools, ["read", "write"]);
  assert.deepEqual(parsed.modes.code.excludeTools, ["write"]);
  assert.deepEqual(parsed.modes.code.skills, ["test-driven-development"]);
  assert.deepEqual(parsed.modes.code.excludeSkills, ["officecli"]);
});

test("parseModeConfig accepts deny-only resource lists", () => {
  const parsed = parseModeConfig(
    `
version: 1
modes:
  code:
    model: openai/gpt
    excludeTools: [write]
    excludeSkills: [officecli]
`,
    "/config/modes.yaml",
  );

  assert.equal(parsed.modes.code.tools, undefined);
  assert.equal(parsed.modes.code.skills, undefined);
});

test("parseModeConfig rejects a mode without allow or deny lists", () => {
  assert.throws(
    () => parseModeConfig("version: 1\nmodes:\n  code:\n    model: openai/gpt\n", "/config/modes.yaml"),
    (error: unknown) => error instanceof ConfigValidationError && error.message.includes("tools or excludeTools"),
  );
});

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

test("modes.example.yaml stays valid", async () => {
  const path = fileURLToPath(new URL("../modes.example.yaml", import.meta.url));
  const parsed = parseModeConfig(await readFile(path, "utf8"), path);
  assert.equal(parsed.defaultMode, "plan");
  assert.deepEqual(Object.keys(parsed.modes), ["plan", "code"]);
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
