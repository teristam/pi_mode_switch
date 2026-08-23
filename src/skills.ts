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
    const selectedSkills = mode.excludeSkills !== undefined
      ? [...this.catalogue.keys()].filter((name) => !mode.excludeSkills!.includes(name))
      : [...(mode.skills ?? [])];
    const lines = [
      `[ACTIVE MODE: ${modeName}]`,
      `Configured model: ${mode.model}`,
      mode.excludeTools !== undefined
        ? `Active tools: all discovered except ${unique(mode.excludeTools).join(", ") || "none banned"}`
        : `Active tools: ${unique([...(mode.tools ?? []), MODE_SWITCH_TOOL]).join(", ")}`,
      mode.excludeSkills !== undefined
        ? `Auto-loaded skills: all discovered except ${unique(mode.excludeSkills).join(", ") || "(none banned)"}`
        : `Auto-loaded skills: ${unique(selectedSkills).join(", ") || "(none)"}`,
    ];
    if (mode.instructions) lines.push("", "Mode instructions:", mode.instructions);

    for (const name of unique(selectedSkills)) {
      const skill = this.catalogue.get(name);
      if (!skill) {
        this.warnOnce(`missing:${modeName}:${name}`, `Mode "${modeName}": unknown skill "${name}"`, warn);
        continue;
      }
      const content = await this.readSkill(skill);
      if (content === undefined) {
        this.warnOnce(
          `read:${skill.filePath}`,
          `Mode "${modeName}": could not read skill "${name}" at ${skill.filePath}`,
          warn,
        );
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
