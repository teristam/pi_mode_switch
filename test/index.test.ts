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
  await writeFile(
    join(agentDir, "modes.yaml"),
    `
version: 1
defaultMode: plan
modes:
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
`,
    "utf8",
  );
  return { root, agentDir };
}

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
    setActiveTools: (names: string[]) => {
      activeTools = names;
    },
    setModel: async (model: any) => !(options.failCode && model.id === "code-model"),
    setThinkingLevel: (level: string) => {
      thinking = level;
    },
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
    get activeTools() {
      return activeTools;
    },
  };
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
    registerTool: (tool: any) => {
      tools.set(tool.name, tool);
    },
    getAllTools: () => ["read", "edit", ...tools.keys()].map((name) => ({ name })),
    getActiveTools: () => activeTools,
    setActiveTools: (names: string[]) => {
      activeTools = names;
    },
    setModel: async () => true,
    setThinkingLevel: (level: string) => {
      thinking = level;
    },
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
    setActiveTools: (names: string[]) => {
      activeTools = names;
    },
    setModel: async () => true,
    setThinkingLevel: (level: string) => {
      thinking = level;
    },
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
    setActiveTools: (names: string[]) => {
      activeTools = names;
    },
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
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("modes.yaml") &&
      error.message.includes(join(root, ".pi", "modes.yaml")),
  );
});
