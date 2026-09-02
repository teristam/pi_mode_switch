import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import type { Model, ModelsRefreshResult } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { createModelSelectorRuntime, getModeConfigTargets, modelReference, serializeModeConfig, type ModeConfigTarget } from "../src/mode-editor.ts";
import * as modeEditor from "../src/mode-editor.ts";
import { parseModeConfig } from "../src/config.ts";

type ModelSelectorFactory = (
  tui: TUI,
  currentValue: string,
  ctx: { modelRegistry: Parameters<typeof createModelSelectorRuntime>[0]; scopedModels: [] },
  done: (value?: string) => void,
) => { dispose(): void };

test("mode editor adapts the registry for the built-in model selector", async () => {
  const model = { provider: "openai", id: "gpt-5", name: "GPT-5" } as Model<any>;
  const refreshResult: ModelsRefreshResult = { aborted: false, errors: new Map() };
  let refreshOptions: unknown;
  const registry: Parameters<typeof createModelSelectorRuntime>[0] = {
    getAvailable: () => [model],
    find: (provider: string, modelId: string) => provider === model.provider && modelId === model.id ? model : undefined,
    refresh: async (options) => {
      refreshOptions = options;
      return refreshResult;
    },
    getError: () => "catalog unavailable",
  };

  const runtime = createModelSelectorRuntime(registry);

  assert.deepEqual(runtime.getAvailableSnapshot(), [model]);
  assert.equal(runtime.getModel("openai", "gpt-5"), model);
  assert.equal(runtime.getModel("openai", "missing"), undefined);
  assert.equal(runtime.getError(), "catalog unavailable");
  assert.deepEqual(await runtime.refresh({ signal: AbortSignal.timeout(1) }), refreshResult);
  assert.ok(refreshOptions);
});

test("mode editor constructs the model selector with the runtime in the current API position", () => {
  initTheme();
  const createModeModelSelector = (modeEditor as typeof modeEditor & {
    createModeModelSelector?: ModelSelectorFactory;
  }).createModeModelSelector;
  assert.equal(typeof createModeModelSelector, "function");
  if (!createModeModelSelector) return;

  const model = { provider: "openai", id: "gpt-5", name: "GPT-5" } as Model<any>;
  const registry: Parameters<typeof createModelSelectorRuntime>[0] = {
    getAvailable: () => [model],
    find: (provider, modelId) => provider === model.provider && modelId === model.id ? model : undefined,
    refresh: async () => ({ aborted: false, errors: new Map() }),
    getError: () => undefined,
  };
  const selector = createModeModelSelector(
    { requestRender() {} } as TUI,
    "openai/gpt-5",
    { modelRegistry: registry, scopedModels: [] },
    () => {},
  );

  assert.ok(selector);
  selector.dispose();
});

test("mode editor formats selected model references", () => {
  assert.equal(modelReference({ provider: "openai", id: "gpt-5" }), "openai/gpt-5");
});

test("mode editor exposes global and trusted project targets", () => {
  const targets = getModeConfigTargets("/home/user/.pi/agent", "/repo", ".pi", true);

  assert.deepEqual(targets, [
    { kind: "global", label: "Global", path: join("/home/user/.pi/agent", "modes.yaml") },
    { kind: "project", label: "Project", path: join("/repo", ".pi", "modes.yaml") },
  ] satisfies ModeConfigTarget[]);
});

test("mode editor hides untrusted project target", () => {
  const targets = getModeConfigTargets("/agent", "/repo", ".pi", false);

  assert.deepEqual(targets, [{ kind: "global", label: "Global", path: join("/agent", "modes.yaml") }]);
});

test("mode editor serializes only editable YAML fields", () => {
  const source = {
    version: 1 as const,
    defaultMode: "plan",
    sourcePath: "/repo/.pi/modes.yaml",
    modes: {
      plan: {
        model: "openai-codex/gpt-5.6-sol",
        provider: "openai-codex",
        modelId: "gpt-5.6-sol",
        thinkingLevel: "xhigh" as const,
        tools: ["read", "grep"],
        skills: ["brainstorming"],
        instructions: "Plan only.",
      },
    },
  };

  const serialized = serializeModeConfig(source);
  const parsed = parseModeConfig(serialized, source.sourcePath);

  assert.deepEqual(parsed.modes.plan, {
    model: "openai-codex/gpt-5.6-sol",
    provider: "openai-codex",
    modelId: "gpt-5.6-sol",
    thinkingLevel: "xhigh",
    tools: ["read", "grep"],
    skills: ["brainstorming"],
    instructions: "Plan only.",
  });
  assert.doesNotMatch(serialized, /provider:/);
  assert.doesNotMatch(serialized, /modelId:/);
});

test("mode editor preserves combined allow and deny lists", () => {
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
        excludeTools: ["write"],
        skills: ["test-driven-development"],
        excludeSkills: ["officecli"],
      },
    },
  });

  const parsed = parseModeConfig(serialized, "/project/.pi/modes.yaml");
  assert.deepEqual(parsed.modes.code.tools, ["read", "write"]);
  assert.deepEqual(parsed.modes.code.excludeTools, ["write"]);
  assert.deepEqual(parsed.modes.code.skills, ["test-driven-development"]);
  assert.deepEqual(parsed.modes.code.excludeSkills, ["officecli"]);
});

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

test("mode editor serializes optional fields without inventing them", () => {
  const serialized = serializeModeConfig({
    version: 1,
    sourcePath: "/global/modes.yaml",
    modes: {
      code: {
        model: "anthropic/claude",
        provider: "anthropic",
        modelId: "claude",
        tools: ["read", "write"],
        skills: [],
      },
    },
  });

  assert.equal(serialized.includes("defaultMode:"), false);
  assert.equal(serialized.includes("thinkingLevel:"), false);
  assert.equal(serialized.includes("instructions:"), false);
});
