# pi-mode-switch

A pi extension that loads complete agent modes from YAML. A mode selects one model, an exact tool set, auto-loaded skills, and optional thinking/instructions.

> Pi packages execute with your full user permissions. Review this extension and every selected skill before installing it.

## Install

From this checkout:

```bash
npm install
pi install .
```

For one run without installing:

```bash
pi -e .
```

## Configure

Copy `modes.example.yaml` to either location:

- Global: `~/.pi/agent/modes.yaml`
- Project: `<project>/.pi/modes.yaml`

Project configuration is read only after pi trusts the project. Project modes replace global modes with the same name; other global modes remain. A project `defaultMode` overrides the global value.

Every mode requires `model`, `tools`, and `skills`. Use `provider/model-id`; the provider is the text before the first slash. `thinkingLevel` and `instructions` are optional.

```yaml
version: 1
defaultMode: plan
modes:
  plan:
    model: openai-codex/gpt-5.4
    thinkingLevel: high
    tools: [read, grep, find, ls]
    skills: [brainstorming, writing-plans]
    instructions: |
      Plan only. Do not modify files.
```

The configured model must already exist in pi and have working credentials. Tool and skill names must match resources discovered by pi. `mode_switch` is added automatically and cannot be removed by a mode profile.

After editing YAML, run `/reload`.

## Switch modes

- `/mode` opens the TUI mode editor. Choose the global or trusted project `modes.yaml`, then edit an existing mode or create a new one.
- The editor supports model, thinking level, tools, skills, and instructions. Saving validates the selected file and reloads the extension automatically.
- `/mode code` switches directly.
- The agent can call `mode_switch({ mode: "code" })`.

New sessions use `defaultMode`. Explicit switches are stored as branch-aware custom session entries, so resume and tree navigation restore the branch's mode.

Selected skills are read in full and attached as ephemeral context before every model request. Other discovered skills remain available through pi's normal skill catalogue.

## Errors

Invalid files are reported with their path and field. An invalid project file does not disable a valid global file. Unknown models/tools reject a switch before tool or thinking state changes. Unknown or unreadable skills are warned and omitted while the rest of the mode remains active.

## Security boundary

Modes are workflow profiles, not sandboxes. An enabled `bash` tool can still modify files, and the agent is explicitly allowed to switch from a plan mode to a code mode. Use a separate permission or sandbox extension when enforcement is required.

## Develop

```bash
npm test
npm run typecheck
npm pack --dry-run
```
