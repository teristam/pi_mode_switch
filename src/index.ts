import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModeConfig } from "./config.ts";
import { MODE_SWITCH_TOOL, ModeController, type ModeRuntime } from "./mode-controller.ts";
import { openModeEditor, writeModeConfigFile } from "./mode-editor.ts";
import { ensureGlobalModesFile } from "./seed.ts";
import { SkillContextBuilder } from "./skills.ts";
import type { AppliedMode, LoadedModeConfig, ModeSwitchState, ThinkingLevel } from "./types.ts";

const BUNDLED_CONFIG_PATH = fileURLToPath(new URL("../modes.yaml", import.meta.url));
const STATE_TYPE = "mode-switch-state";
const CONTEXT_TYPE = "mode-switch-context";

export interface ModeSwitchExtensionDependencies {
  getAgentDirectory?: () => string;
  configDirName?: string;
  bundledConfigPath?: string;
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
    let triggerModes = new Map<string, string>();
    let currentContext: ExtensionContext | undefined;
    let toolRegistered = false;
    let discoveredSkillNames: string[] = [];
    const warnedTriggerSkills = new Set<string>();
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

    async function editModeConfig(ctx: ExtensionCommandContext): Promise<void> {
      const commandApi = pi as ExtensionAPI & {
        getCommands?: () => Array<{ name: string; source?: string }>;
      };
      const commandSkills = commandApi.getCommands?.()
        .filter((command) => command.source === "skill")
        .map((command) => command.name.replace(/^skill:/, "")) ?? [];
      const skillNames = [...new Set([...discoveredSkillNames, ...commandSkills])].sort();

      const result = await openModeEditor(ctx, {
        agentDir: (dependencies.getAgentDirectory ?? getAgentDir)(),
        cwd: ctx.cwd,
        configDirName: dependencies.configDirName ?? CONFIG_DIR_NAME,
        projectTrusted: ctx.isProjectTrusted(),
        toolNames: pi.getAllTools().map((tool) => tool.name),
        skillNames,
      });
      if (!result) return;

      try {
        await writeModeConfigFile(result.target.path, result.config);
        notify(ctx, `Saved ${result.target.path}; reloading mode configuration`, "info");
        await ctx.reload();
      } catch (error) {
        notify(ctx, `Could not save ${result.target.path}: ${errorMessage(error)}`, "error");
      }
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

    async function activateForSkill(skillName: string, ctx: ExtensionContext): Promise<boolean> {
      const modeName = triggerModes.get(skillName);
      if (!modeName || active?.name === modeName) return false;
      await activate(modeName, ctx, true);
      notify(ctx, `Skill "${skillName}" activated mode "${modeName}"`, "info");
      return true;
    }

    async function restore(ctx: ExtensionContext): Promise<void> {
      if (!loaded?.config || !controller) {
        active = undefined;
        updateStatus(ctx);
        return;
      }

      const stored = savedMode(ctx);
      const targets = [stored && loaded.config.modes[stored] ? stored : undefined, loaded.config.defaultMode].filter(
        (name, index, all): name is string => Boolean(name) && all.indexOf(name) === index,
      );
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
      const profiles = names
        .map((name) => {
          const mode = loaded!.config!.modes[name];
          const tools = mode.excludeTools !== undefined
            ? `all except ${mode.excludeTools.join(", ") || "none banned"}`
            : mode.tools?.join(", ") || "none";
          const skills = mode.excludeSkills !== undefined
            ? `all except ${mode.excludeSkills.join(", ") || "none banned"}`
            : mode.skills?.join(", ") || "none";
          return `${name} (${mode.model}; tools: ${tools}; skills: ${skills})`;
        })
        .join("; ");

      pi.registerTool({
        name: MODE_SWITCH_TOOL,
        label: "Switch Mode",
        description: profiles
          ? `Switch to a configured agent mode. Available profiles: ${profiles}`
          : unavailableMessage(),
        promptSnippet: "Switch model, tools, instructions, and auto-loaded skills to another configured mode",
        promptGuidelines: [
          "Use mode_switch when another configured mode is a better fit; call it before doing work that needs the new mode.",
        ],
        parameters: Type.Object({ mode: modeParameter }),
        executionMode: "sequential",
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const applied = await activate(params.mode, ctx, true);
          return {
            content: [
              {
                type: "text",
                text: `Switched to mode "${applied.name}" (${applied.definition.model}); thinking: ${applied.effectiveThinkingLevel}; tools: ${applied.activeTools.join(", ")}; skills: ${applied.definition.excludeSkills !== undefined ? `all except ${applied.definition.excludeSkills.join(", ") || "none banned"}` : applied.definition.skills?.join(", ") || "none"}.`,
              },
            ],
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
        const name = args.trim();
        if (!name) {
          await editModeConfig(ctx);
          return;
        }
        if (!loaded?.config) {
          notify(ctx, unavailableMessage(), "error");
          return;
        }

        try {
          await activate(name, ctx, true);
          notify(ctx, `Mode "${name}" activated`, "info");
        } catch (error) {
          notify(ctx, errorMessage(error), "error");
        }
      },
    });

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

    pi.on("session_start", async (_event, ctx) => {
      currentContext = ctx;
      const agentDir = (dependencies.getAgentDirectory ?? getAgentDir)();
      const bundledPath = dependencies.bundledConfigPath ?? BUNDLED_CONFIG_PATH;
      try {
        if (await ensureGlobalModesFile(agentDir, bundledPath)) {
          notify(ctx, `Created default mode configuration at ${join(agentDir, "modes.yaml")}`, "info");
        }
      } catch (error) {
        notify(ctx, `Could not create default mode configuration at ${join(agentDir, "modes.yaml")}: ${errorMessage(error)}`);
      }

      loaded = await loadModeConfig({
        cwd: ctx.cwd,
        agentDir,
        configDirName: dependencies.configDirName ?? CONFIG_DIR_NAME,
        projectTrusted: ctx.isProjectTrusted(),
      });
      for (const diagnostic of loaded.diagnostics) notify(ctx, diagnostic.message);

      if (loaded.config) {
        triggerModes = new Map(
          Object.entries(loaded.config.modes).flatMap(([modeName, mode]) =>
            (mode.triggerSkills ?? []).map((skillName) => [skillName, modeName] as const),
          ),
        );
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
        triggerModes = new Map();
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
      const catalogue = (event.systemPromptOptions.skills ?? []) as Skill[];
      skills.setCatalogue(catalogue);
      discoveredSkillNames = catalogue.map((skill) => skill.name);
      const discovered = new Set(discoveredSkillNames);
      for (const [skillName, modeName] of triggerModes) {
        if (discovered.has(skillName) || warnedTriggerSkills.has(skillName)) continue;
        warnedTriggerSkills.add(skillName);
        notify(ctx, `Mode "${modeName}": unknown trigger skill "${skillName}"`);
      }
    });

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
