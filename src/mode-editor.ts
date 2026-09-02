import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import {
  DynamicBorder,
  ModelSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  Component,
  EditorTheme,
  SelectItem,
  SelectListTheme,
  SettingItem,
  TUI,
} from "@earendil-works/pi-tui";
import {
  Container,
  Editor,
  Key,
  matchesKey,
  SelectList,
  SettingsList,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { parseModeConfig } from "./config.ts";
import type { ModeConfigSource, ModeDefinition, ThinkingLevel } from "./types.ts";
import { THINKING_LEVELS } from "./types.ts";

export interface ModeConfigTarget {
  kind: "global" | "project";
  label: string;
  path: string;
}

export interface ModeEditorSave {
  target: ModeConfigTarget;
  config: ModeConfigSource;
}

export function getModeConfigTargets(
  agentDir: string,
  cwd: string,
  configDirName: string,
  projectTrusted: boolean,
): ModeConfigTarget[] {
  const targets: ModeConfigTarget[] = [
    { kind: "global", label: "Global", path: join(agentDir, "modes.yaml") },
  ];
  if (projectTrusted) {
    targets.push({ kind: "project", label: "Project", path: join(cwd, configDirName, "modes.yaml") });
  }
  return targets;
}

export function serializeModeConfig(config: ModeConfigSource): string {
  const modes: Record<string, Record<string, unknown>> = {};
  for (const [name, mode] of Object.entries(config.modes)) {
    modes[name] = {
      model: mode.model,
      ...(mode.thinkingLevel ? { thinkingLevel: mode.thinkingLevel } : {}),
      ...(mode.tools !== undefined ? { tools: [...mode.tools] } : {}),
      ...(mode.excludeTools !== undefined ? { excludeTools: [...mode.excludeTools] } : {}),
      ...(mode.skills !== undefined ? { skills: [...mode.skills] } : {}),
      ...(mode.excludeSkills !== undefined ? { excludeSkills: [...mode.excludeSkills] } : {}),
      ...(mode.triggerSkills !== undefined ? { triggerSkills: [...mode.triggerSkills] } : {}),
      ...(mode.instructions ? { instructions: mode.instructions } : {}),
    };
  }

  return stringify(
    {
      version: 1,
      ...(config.defaultMode ? { defaultMode: config.defaultMode } : {}),
      modes,
    },
    { indent: 2, lineWidth: 0 },
  );
}

export async function readModeConfigFile(path: string): Promise<ModeConfigSource> {
  try {
    return parseModeConfig(await readFile(path, "utf8"), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, modes: {}, sourcePath: path };
    }
    throw error;
  }
}

export async function writeModeConfigFile(path: string, config: ModeConfigSource): Promise<void> {
  const source = serializeModeConfig(config);
  parseModeConfig(source, path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source, "utf8");
}

type ThemeLike = { fg: (color: any, text: string) => string };

const SELECT_LIST_THEME: SelectListTheme = {
  selectedPrefix: (text) => text,
  selectedText: (text) => text,
  description: (text) => text,
  scrollInfo: (text) => text,
  noMatch: (text) => text,
};

const EDITOR_THEME: EditorTheme = {
  borderColor: (text) => text,
  selectList: SELECT_LIST_THEME,
};

type ModelSelectorRegistry = Pick<
  ExtensionContext["modelRegistry"],
  "getAvailable" | "find" | "refresh" | "getError"
>;

export function createModelSelectorRuntime(registry: ModelSelectorRegistry): ModelRuntime {
  // ModelSelectorComponent only needs these runtime methods, but its public constructor accepts ModelRuntime.
  return {
    getAvailableSnapshot: () => registry.getAvailable(),
    getModel: (provider: string, modelId: string) => registry.find(provider, modelId),
    refresh: (options: Parameters<ModelRuntime["refresh"]>[0]) => registry.refresh(options),
    getError: () => registry.getError(),
  } as unknown as ModelRuntime;
}

export function modelReference(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

export function createModeModelSelector(
  tui: TUI,
  currentValue: string,
  ctx: Pick<ExtensionContext, "modelRegistry" | "scopedModels">,
  done: (value?: string) => void,
): ModelSelectorComponent {
  const separator = currentValue.indexOf("/");
  const currentModel = separator > 0
    ? ctx.modelRegistry.find(currentValue.slice(0, separator), currentValue.slice(separator + 1))
    : undefined;

  return new ModelSelectorComponent(
    tui,
    currentModel,
    createModelSelectorRuntime(ctx.modelRegistry),
    ctx.scopedModels,
    (model) => done(modelReference(model)),
    () => done(),
  );
}

function displayList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "(none)";
}

function cloneMode(mode: ModeDefinition): ModeDefinition {
  return {
    ...mode,
    ...(mode.tools !== undefined ? { tools: [...mode.tools] } : {}),
    ...(mode.excludeTools !== undefined ? { excludeTools: [...mode.excludeTools] } : {}),
    ...(mode.skills !== undefined ? { skills: [...mode.skills] } : {}),
    ...(mode.excludeSkills !== undefined ? { excludeSkills: [...mode.excludeSkills] } : {}),
    ...(mode.triggerSkills !== undefined ? { triggerSkills: [...mode.triggerSkills] } : {}),
  };
}

function modeItems(config: ModeConfigSource): SelectItem[] {
  return [
    ...Object.entries(config.modes).map(([name, mode]) => ({
      value: name,
      label: name,
      description: `${mode.model} · ${mode.excludeTools !== undefined ? "all tools except denied" : `${mode.tools?.length ?? 0} tools`} · ${mode.excludeSkills !== undefined ? "all skills except denied" : `${mode.skills?.length ?? 0} skills`} · ${mode.triggerSkills?.length ?? 0} triggers`,
    })),
    { value: "__new__", label: "+ Create new mode", description: "Add another mode to this file" },
  ];
}

function withFrame(title: string, theme: ThemeLike, content: Component): Container {
  const container = new Container();
  container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
  container.addChild(new Text(theme.fg("accent", title), 1, 0));
  container.addChild(content);
  container.addChild(new Text(theme.fg("dim", "↑↓ navigate · Enter select · Esc back"), 1, 0));
  container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
  return container;
}

async function selectTarget(ctx: ExtensionContext, targets: ModeConfigTarget[]): Promise<ModeConfigTarget | undefined> {
  if (targets.length === 1) return targets[0];
  const labels = targets.map((target) => `${target.label}: ${target.path}`);
  const selected = await ctx.ui.select("Select modes.yaml to edit", labels);
  return targets[labels.indexOf(selected ?? "")];
}

async function selectMode(ctx: ExtensionContext, config: ModeConfigSource): Promise<string | undefined> {
  const result = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
    const list = new SelectList(modeItems(config), Math.min(Math.max(Object.keys(config.modes).length + 1, 3), 10), {
      ...SELECT_LIST_THEME,
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    const container = withFrame("Select mode", theme, list);
    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
  return result ?? undefined;
}

class SelectValueSubmenu extends Container {
  private readonly list: SelectList;

  constructor(
    tui: { requestRender: () => void },
    theme: ThemeLike,
    title: string,
    description: string,
    items: SelectItem[],
    currentValue: string,
    done: (value?: string) => void,
  ) {
    super();
    this.addChild(new Text(theme.fg("accent", title), 1, 0));
    this.addChild(new Text(theme.fg("muted", description), 1, 0));
    this.list = new SelectList(items, Math.min(Math.max(items.length, 1), 10), {
      ...SELECT_LIST_THEME,
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    const selectedIndex = items.findIndex((item) => item.value === currentValue);
    if (selectedIndex >= 0) this.list.setSelectedIndex(selectedIndex);
    this.list.onSelect = (item) => done(item.value);
    this.list.onCancel = () => done();
    this.addChild(this.list);
    this.addChild(new Text(theme.fg("dim", "Enter select · Esc back"), 1, 0));
    void tui;
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }
}

class TextValueSubmenu extends Container {
  private readonly editor: Editor;
  private readonly done: (value?: string) => void;

  constructor(
    tui: TUI,
    theme: ThemeLike,
    title: string,
    description: string,
    value: string,
    done: (value?: string) => void,
  ) {
    super();
    this.done = done;
    this.addChild(new Text(theme.fg("accent", title), 1, 0));
    this.addChild(new Text(theme.fg("muted", description), 1, 0));
    this.editor = new Editor(tui, {
      ...EDITOR_THEME,
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        ...SELECT_LIST_THEME,
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    });
    this.editor.setText(value);
    this.editor.onSubmit = (text) => done(text);
    this.addChild(this.editor);
    this.addChild(new Text(theme.fg("dim", "Enter submit · Shift+Enter newline · Esc back"), 1, 0));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done();
      return;
    }
    this.editor.handleInput(data);
  }
}

class MultiSelectSubmenu implements Component {
  private selected: Set<string>;
  private index = 0;
  private readonly options: string[];
  private readonly title: string;
  private readonly description: string;
  private readonly theme: ThemeLike;
  private readonly done: (value?: string) => void;
  private readonly onChange: (values: string[]) => void;
  private readonly tui: { requestRender: () => void };

  constructor(
    tui: { requestRender: () => void },
    theme: ThemeLike,
    title: string,
    description: string,
    options: string[],
    current: string[],
    done: (value?: string) => void,
    onChange: (values: string[]) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.title = title;
    this.description = description;
    this.options = [...new Set([...current, ...options])].sort();
    this.selected = new Set(current);
    this.done = done;
    this.onChange = onChange;
  }

  render(width: number): string[] {
    const lines = [
      this.theme.fg("accent", this.title),
      this.theme.fg("muted", this.description),
      "",
    ];
    for (let i = 0; i < this.options.length; i++) {
      const option = this.options[i] ?? "";
      const prefix = i === this.index ? this.theme.fg("accent", "> ") : "  ";
      const checked = this.selected.has(option) ? this.theme.fg("success", "[x] ") : "[ ] ";
      lines.push(truncateToWidth(`${prefix}${checked}${option}`, width));
    }
    lines.push("", this.theme.fg("dim", "↑↓ move · Space toggle · Enter save · Esc back"));
    return lines.map((line) => truncateToWidth(line, width));
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.index = this.options.length === 0 ? 0 : (this.index - 1 + this.options.length) % this.options.length;
    } else if (matchesKey(data, Key.down)) {
      this.index = this.options.length === 0 ? 0 : (this.index + 1) % this.options.length;
    } else if (matchesKey(data, Key.space)) {
      const option = this.options[this.index];
      if (option) {
        if (this.selected.has(option)) this.selected.delete(option);
        else this.selected.add(option);
      }
    } else if (matchesKey(data, Key.enter)) {
      const values = [...this.selected].sort();
      this.onChange(values);
      this.done(values.join(", "));
    } else if (matchesKey(data, Key.escape)) {
      this.done();
    }
    this.tui.requestRender();
  }

  invalidate(): void {}
}

interface ModeDraft {
  name: string;
  oldName?: string;
  definition: ModeDefinition;
}

function modeSettings(
  ctx: ExtensionContext,
  config: ModeConfigSource,
  draft: ModeDraft,
  toolNames: string[],
  skillNames: string[],
  onDone: (draft: ModeDraft | null) => void,
): Promise<ModeDraft | null> {
  return ctx.ui.custom<ModeDraft | null>((tui, theme, _keybindings, done) => {
    let workingName = draft.name;
    const working = cloneMode(draft.definition);

    const settings: SettingItem[] = [
      {
        id: "name",
        label: "Mode name",
        description: "Unique name used by /mode <name>",
        currentValue: workingName,
        submenu: (currentValue, submenuDone) =>
          new TextValueSubmenu(tui, theme, "Mode name", "Use a short, unique name.", currentValue, submenuDone),
      },
      {
        id: "model",
        label: "Model",
        description: "Provider/model-id, for example openai-codex/gpt-5.6-sol",
        currentValue: working.model,
        submenu: (currentValue, submenuDone) =>
          createModeModelSelector(tui, currentValue, ctx, submenuDone),
      },
      {
        id: "thinkingLevel",
        label: "Thinking level",
        description: "Reasoning depth; unset preserves the current runtime level",
        currentValue: working.thinkingLevel ?? "(unset)",
        values: ["(unset)", ...THINKING_LEVELS],
      },
      {
        id: "allowedTools",
        label: "Allowed tools",
        description: "Allowlist entry; inactive when not present in YAML",
        currentValue: working.tools === undefined ? "(inactive)" : displayList(working.tools),
        submenu: (_currentValue, submenuDone) =>
          new MultiSelectSubmenu(
            tui,
            theme,
            "Allowed tools",
            "Select tools to write to the tools allowlist. mode_switch is always enabled.",
            toolNames.filter((name) => name !== "mode_switch"),
            working.tools ?? [],
            submenuDone,
            (values) => {
              working.tools = values;
            },
          ),
      },
      {
        id: "bannedTools",
        label: "Banned tools",
        description: "Denylist entry; inactive when not present in YAML",
        currentValue: working.excludeTools === undefined ? "(inactive)" : displayList(working.excludeTools),
        submenu: (_currentValue, submenuDone) =>
          new MultiSelectSubmenu(
            tui,
            theme,
            "Banned tools",
            "Select tools to exclude. Newly discovered tools remain allowed unless banned.",
            toolNames.filter((name) => name !== "mode_switch"),
            working.excludeTools ?? [],
            submenuDone,
            (values) => {
              working.excludeTools = values;
            },
          ),
      },
      {
        id: "allowedSkills",
        label: "Allowed skills",
        description: "Allowlist entry; inactive when not present in YAML",
        currentValue: working.skills === undefined ? "(inactive)" : displayList(working.skills),
        submenu: (_currentValue, submenuDone) =>
          new MultiSelectSubmenu(
            tui,
            theme,
            "Allowed skills",
            "Select skills to write to the skills allowlist.",
            skillNames,
            working.skills ?? [],
            submenuDone,
            (values) => {
              working.skills = values;
            },
          ),
      },
      {
        id: "bannedSkills",
        label: "Banned skills",
        description: "Denylist entry; inactive when not present in YAML",
        currentValue: working.excludeSkills === undefined ? "(inactive)" : displayList(working.excludeSkills),
        submenu: (_currentValue, submenuDone) =>
          new MultiSelectSubmenu(
            tui,
            theme,
            "Banned skills",
            "Select skills to exclude. Other discovered skills are auto-loaded.",
            skillNames,
            working.excludeSkills ?? [],
            submenuDone,
            (values) => {
              working.excludeSkills = values;
            },
          ),
      },
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
      {
        id: "instructions",
        label: "Instructions",
        description: "Optional mode-specific instructions",
        currentValue: working.instructions ? "(configured)" : "(none)",
        submenu: (currentValue, submenuDone) =>
          new TextValueSubmenu(
            tui,
            theme,
            "Instructions",
            "Enter text; Shift+Enter inserts a newline.",
            currentValue === "(none)" || currentValue === "(configured)" ? working.instructions ?? "" : currentValue,
            submenuDone,
          ),
      },
      {
        id: "save",
        label: "Save changes",
        description: "Validate this mode and save the selected modes.yaml",
        currentValue: "save",
        values: ["save"],
      },
    ];

    const settingsList = new SettingsList(
      settings,
      Math.min(settings.length, 10),
      {
        label: (text, selected) => selected ? theme.fg("accent", text) : text,
        value: (text, selected) => selected ? theme.fg("accent", text) : theme.fg("muted", text),
        description: (text) => theme.fg("dim", text),
        cursor: theme.fg("accent", "> "),
        hint: (text) => theme.fg("dim", text),
      },
      (id, value) => {
        switch (id) {
          case "name":
            workingName = value.trim();
            break;
          case "model":
            working.model = value.trim();
            const separator = working.model.indexOf("/");
            working.provider = separator > 0 ? working.model.slice(0, separator) : "";
            working.modelId = separator > 0 ? working.model.slice(separator + 1) : "";
            break;
          case "thinkingLevel":
            if (value === "(unset)") delete working.thinkingLevel;
            else working.thinkingLevel = value as ThinkingLevel;
            break;
          case "instructions":
            if (value.trim()) working.instructions = value;
            else delete working.instructions;
            break;
          case "save": {
            const error = validateDraft(config, workingName, draft.oldName, working);
            if (error) {
              ctx.ui.notify(error, "error");
              settingsList.updateValue("save", "save");
              return;
            }
            onDone({ name: workingName, oldName: draft.oldName, definition: cloneMode(working) });
            done({ name: workingName, oldName: draft.oldName, definition: cloneMode(working) });
            break;
          }
        }
      },
      () => {
        onDone(null);
        done(null);
      },
    );

    const container = new Container();
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", `Configure mode: ${draft.name}`), 1, 0));
    container.addChild(settingsList);
    container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

    return {
      render: (width) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        settingsList.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

function validateDraft(config: ModeConfigSource, name: string, oldName: string | undefined, mode: ModeDefinition): string | undefined {
  if (!name) return "Mode name cannot be empty";
  if (name !== oldName && config.modes[name]) return `Mode "${name}" already exists`;
  if (!mode.model || !mode.model.includes("/") || mode.model.startsWith("/") || mode.model.endsWith("/")) {
    return "Model must use provider/model-id";
  }
  if (mode.tools === undefined && mode.excludeTools === undefined) {
    return "Configure either allowed tools or banned tools";
  }
  if (mode.skills === undefined && mode.excludeSkills === undefined) {
    return "Configure either allowed skills or banned skills";
  }
  return undefined;
}

function applyDraft(config: ModeConfigSource, draft: ModeDraft): ModeConfigSource {
  const modes = { ...config.modes };
  if (draft.oldName && draft.oldName !== draft.name) delete modes[draft.oldName];
  modes[draft.name] = {
    ...draft.definition,
    provider: draft.definition.model.slice(0, draft.definition.model.indexOf("/")),
    modelId: draft.definition.model.slice(draft.definition.model.indexOf("/") + 1),
  };
  const defaultMode = config.defaultMode === draft.oldName
    ? draft.name
    : config.defaultMode ?? (Object.keys(config.modes).length === 0 ? draft.name : undefined);
  return {
    ...config,
    ...(defaultMode ? { defaultMode } : {}),
    modes,
    sourcePath: config.sourcePath,
  };
}

export async function openModeEditor(
  ctx: ExtensionContext,
  options: {
    agentDir: string;
    cwd: string;
    configDirName: string;
    projectTrusted: boolean;
    toolNames: string[];
    skillNames: string[];
  },
): Promise<ModeEditorSave | null> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("/mode requires TUI mode", "error");
    return null;
  }

  const targets = getModeConfigTargets(options.agentDir, options.cwd, options.configDirName, options.projectTrusted);
  const target = await selectTarget(ctx, targets);
  if (!target) return null;

  let config: ModeConfigSource;
  try {
    config = await readModeConfigFile(target.path);
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    return null;
  }

  const selectedName = await selectMode(ctx, config);
  if (!selectedName) return null;

  const oldName = selectedName === "__new__" ? undefined : selectedName;
  const existing = oldName ? config.modes[oldName] : undefined;
  const draft: ModeDraft = {
    name: oldName ?? "new-mode",
    oldName,
    definition: existing
      ? cloneMode(existing)
      : {
          model: "",
          provider: "",
          modelId: "",
          tools: [],
          skills: [],
        },
  };

  const edited = await modeSettings(ctx, config, draft, options.toolNames, options.skillNames, () => undefined);
  if (!edited) return null;
  return { target, config: applyDraft(config, edited) };
}
