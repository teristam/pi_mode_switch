import assert from "node:assert/strict";
import test from "node:test";
import { ModeController } from "../src/mode-controller.ts";
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
    get tools() {
      return tools;
    },
    adapter: {
      getAllToolNames: () => ["read", "edit", "mode_switch"],
      findModel: (provider: string, id: string) =>
        provider === "openrouter" && id === "anthropic/plan" ? { provider, id } : undefined,
      setModel: async () => {
        calls.push("model");
        return setModelResult;
      },
      setThinkingLevel: (level: ThinkingLevel) => {
        calls.push("thinking");
        thinking = level;
      },
      getThinkingLevel: () => thinking,
      setActiveTools: (names: string[]) => {
        calls.push("tools");
        tools = names;
      },
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
  await assert.rejects(
    () => new ModeController(unknownModel, fake.adapter).apply("plan"),
    /model openrouter\/missing was not found/,
  );
  assert.deepEqual(fake.calls, []);
});
