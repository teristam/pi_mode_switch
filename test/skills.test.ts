import assert from "node:assert/strict";
import test from "node:test";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { SkillContextBuilder } from "../src/skills.ts";
import type { ModeDefinition } from "../src/types.ts";

const MODE: ModeDefinition = {
  model: "openai/gpt",
  provider: "openai",
  modelId: "gpt",
  tools: ["read"],
  skills: ["alpha", "missing", "broken", "alpha"],
  instructions: "Plan only.",
};

function skill(name: string, filePath: string): Skill {
  return {
    name,
    description: `${name} description`,
    filePath,
    baseDir: filePath.slice(0, filePath.lastIndexOf("/")),
    sourceInfo: {} as Skill["sourceInfo"],
    disableModelInvocation: false,
  };
}

test("SkillContextBuilder includes selected full contents and metadata", async () => {
  const reads: string[] = [];
  const warnings: string[] = [];
  const builder = new SkillContextBuilder(async (path) => {
    reads.push(path);
    if (path.endsWith("broken/SKILL.md")) throw new Error("denied");
    return "---\nname: alpha\n---\n# Alpha instructions";
  });
  builder.setCatalogue([
    skill("alpha", "/skills/alpha/SKILL.md"),
    skill("unselected", "/skills/unselected/SKILL.md"),
    skill("broken", "/skills/broken/SKILL.md"),
  ]);

  const first = await builder.build("plan", MODE, (message) => warnings.push(message));
  const second = await builder.build("plan", MODE, (message) => warnings.push(message));

  assert.match(first, /\[ACTIVE MODE: plan\]/);
  assert.match(first, /Plan only\./);
  assert.match(first, /file: \/skills\/alpha\/SKILL\.md/);
  assert.match(first, /base directory: \/skills\/alpha/);
  assert.match(first, /# Alpha instructions/);
  assert.doesNotMatch(first, /unselected/);
  assert.equal((first.match(/BEGIN AUTO-LOADED SKILL alpha/g) ?? []).length, 1);
  assert.equal(second, first);
  assert.deepEqual(reads, ["/skills/alpha/SKILL.md", "/skills/broken/SKILL.md"]);
  assert.equal(warnings.filter((message) => message.includes("missing")).length, 1);
  assert.equal(warnings.filter((message) => message.includes("broken")).length, 1);
});

test("SkillContextBuilder auto-loads all discovered skills except denied skills", async () => {
  const warnings: string[] = [];
  const builder = new SkillContextBuilder(async (path) => `# ${path}`);
  builder.setCatalogue([
    skill("alpha", "/skills/alpha/SKILL.md"),
    skill("beta", "/skills/beta/SKILL.md"),
    skill("banned", "/skills/banned/SKILL.md"),
  ]);

  const content = await builder.build(
    "code",
    {
      model: "openai/gpt",
      provider: "openai",
      modelId: "gpt",
      skills: ["alpha"],
      excludeSkills: ["banned"],
      tools: [],
    },
    (message) => warnings.push(message),
  );

  assert.match(content, /BEGIN AUTO-LOADED SKILL alpha/);
  assert.match(content, /BEGIN AUTO-LOADED SKILL beta/);
  assert.doesNotMatch(content, /BEGIN AUTO-LOADED SKILL banned/);
  assert.deepEqual(warnings, []);
});
