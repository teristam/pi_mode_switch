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
      throw new ModeApplyError(
        `unknown mode "${name}"; available modes: ${Object.keys(this.config.modes).join(", ")}`,
      );
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
