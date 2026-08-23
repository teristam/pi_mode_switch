export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ModeDefinition {
  model: string;
  provider: string;
  modelId: string;
  tools?: string[];
  excludeTools?: string[];
  skills?: string[];
  excludeSkills?: string[];
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
