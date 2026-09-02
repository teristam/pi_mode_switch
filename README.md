# pi-mode-switch

A pi extension that loads complete agent modes from YAML. A mode selects one model, an exact tool set, auto-loaded skills, and optional thinking/instructions.

> Pi packages execute with your full user permissions. Review this extension and every selected skill before installing it.

## Install

Install from npm for normal use:

```bash
pi install npm:pi-mode-switch
```

For one run without adding it to your Pi settings:

```bash
pi -e npm:pi-mode-switch
```

From this checkout, install and load the local package for development:

```bash
npm install
pi install .
```

## Configure

On the first session after installation, the extension copies its bundled defaults to `~/.pi/agent/modes.yaml` if that file does not already exist. The global file is user-owned: it is never overwritten, so edit it directly to customize the defaults. If it is deleted, it is recreated on the next session.

A trusted project's `<project>/.pi/modes.yaml` is optional and is merged on top of the global file, with later definitions replacing same-named modes. A project `defaultMode` overrides the global value. The bundled `modes.yaml` is used only to seed the global file and is never loaded directly at runtime.

Every mode requires `model` and either `tools` or `excludeTools`, plus either `skills` or `excludeSkills`. `triggerSkills` is optional and maps explicit or agent-loaded skills to that mode. A skill can trigger only one mode. Use `provider/model-id`; the provider is the text before the first slash. `thinkingLevel` and `instructions` are optional. Allow and deny fields may coexist; deny fields take precedence and automatically include newly discovered resources unless banned.

```yaml
version: 1
defaultMode: plan
modes:
  plan:
    model: openai-codex/gpt-5.4
    thinkingLevel: high
    tools: [read, grep, find, ls]
    skills: [brainstorming, writing-plans]
    triggerSkills: [brainstorming, writing-plans]
    instructions: |
      Plan only. Do not modify files.
```

The configured model must already exist in pi and have working credentials. Tool and skill names must match resources discovered by pi. `mode_switch` is added automatically and cannot be removed by a mode profile. In deny-list mode, all discovered resources are enabled except explicitly banned names.

After editing YAML, run `/reload`.

## Switch modes

- `/mode` opens the TUI mode editor. Choose the global or trusted project `modes.yaml`, then edit an existing mode or create a new one.
- The editor supports model, thinking level, instructions, separate `Allowed tools`, `Banned tools`, `Allowed skills`, `Banned skills`, and `Trigger skills` entries. Saving validates the selected file and reloads the extension automatically.
- `/mode code` switches directly.
- `Ctrl+Alt+M` cycles through configured modes in YAML order.
- The agent can call `mode_switch({ mode: "code" })`.

New sessions use `defaultMode`. Explicit switches are stored as branch-aware custom session entries, so resume and tree navigation restore the branch's mode.

Selected skills are read in full and attached as ephemeral context before every model request. Other discovered skills remain available through pi's normal skill catalogue.

## Skill-triggered modes

A mode's optional `triggerSkills` list is separate from `skills` and `excludeSkills`, which only control auto-loaded context. A mapped skill switches modes in either case:

- The user invokes `/skill:name`.
- The agent reads the exact discovered `SKILL.md` for that skill.

The switch happens before the explicit skill is expanded or the discovered skill file is read. Successful switches use the same branch-aware persistence as `/mode`; if the target is already active, no duplicate state is stored. If activation fails, the explicit command or skill-file read is blocked instead of running in the previous mode. Reads of skill reference files and assets do not trigger a switch.

## Errors

Invalid files are reported with their path and field. An invalid project file does not disable a valid global file. Ambiguous skill trigger assignments are rejected. Unknown models/tools reject a switch before tool or thinking state changes. Unknown or unreadable skills are warned and omitted while the rest of the mode remains active.

## Security boundary

Modes are workflow profiles, not sandboxes. An enabled `bash` tool can still modify files, and the agent is explicitly allowed to switch from a plan mode to a code mode. A skill-triggered switch does not cancel sibling tool calls already emitted in the same assistant message. Use a separate permission or sandbox extension when enforcement is required.

## Develop

```bash
npm test
npm run typecheck
npm pack --dry-run
```

## Release

To publish a new version:

1. Update `version` in `package.json` and commit the change.
2. Push the commit to `master`.
3. Create a matching tag—for example, `git tag v0.1.1`.
4. Push the tag: `git push origin v0.1.1`.

Pushing the tag starts `.github/workflows/publish.yml`. The workflow checks out that tag, runs tests and typecheck, verifies the tag matches `package.json`, and publishes the package to npm. Creating a GitHub Release is optional and does not trigger a separate publish.

Before the first automated release, configure npm Trusted Publishing for `pi-mode-switch` with:

- GitHub owner: `teristam`
- Repository: `pi_mode_switch`
- Workflow file: `publish.yml`
- Environment: none

npm versions are immutable, so each release needs a new package version.
