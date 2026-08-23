# Pi Mode Switch Extension Design

**Date:** 2026-08-23
**Status:** Approved

## Summary

Build `pi-mode-switch`, a reusable pi extension package that defines named agent modes in YAML. Each mode is a complete profile containing a model, active tools, and selected skills, with optional thinking level and behavioral instructions. Users switch modes with `/mode`; the agent switches modes with the always-available `mode_switch` tool.

The extension merges global and trusted project configuration, restores the active mode with session branches, and injects selected skills in full before every model request so a tool-initiated switch takes effect on the next model turn.

## Goals

- Define named modes in YAML rather than TypeScript.
- Associate every mode with a deterministic model, tool set, and skill set.
- Optionally associate a mode with a pi thinking level and behavioral instructions.
- Load global modes and project overrides.
- Let users switch with `/mode [name]`.
- Let the agent switch with `mode_switch`.
- Keep `mode_switch` available in every mode.
- Restore the last active mode when a session resumes or its tree branch changes.
- Provide actionable validation errors and focused automated tests.

## Non-goals

- Hiding unselected skills from pi's normal discovered-skill catalogue.
- Loading arbitrary skill paths from mode YAML.
- Restricting transitions between modes or requiring approval for agent-initiated switches.
- Adding a startup CLI flag or keyboard shortcut.
- Watching YAML files for live changes; pi's normal `/reload` flow reloads configuration.
- Tracking or executing numbered plans.
- Providing mode inheritance or partial profiles in version 1.

## Package Layout

```text
pi-mode-switch/
├── package.json
├── tsconfig.json
├── README.md
├── modes.example.yaml
├── src/
│   ├── config.ts
│   ├── index.ts
│   ├── mode-controller.ts
│   ├── skills.ts
│   └── types.ts
└── test/
    ├── config.test.ts
    ├── index.test.ts
    ├── mode-controller.test.ts
    └── skills.test.ts
```

Responsibilities:

- `src/types.ts`: normalized config, mode, thinking-level, and state types.
- `src/config.ts`: file discovery, YAML parsing, strict structural validation, normalization, merge logic, and diagnostics.
- `src/skills.ts`: resolve configured names against pi's discovered `Skill` metadata, read `SKILL.md`, cache content, and render ephemeral mode context.
- `src/mode-controller.ts`: validate runtime model/tool availability and apply modes through a small adapter that is easy to fake in tests.
- `src/index.ts`: register pi events, command, tool, UI status, and session persistence.

The package uses `yaml` as a runtime dependency. Pi core packages and `typebox` are peer dependencies, following pi package guidance. TypeScript, `tsx`, Node types, and matching pi packages may be development dependencies for local type-checking and tests.

## YAML Configuration

### Locations

Configuration is loaded in this order:

1. `~/.pi/agent/modes.yaml`
2. `<cwd>/.pi/modes.yaml`, only when `ctx.isProjectTrusted()` is true

The implementation uses pi's `getAgentDir()` and `CONFIG_DIR_NAME` rather than hard-coded directory names.

### Schema

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
      Analyze and plan only. Do not modify files.

  code:
    model: anthropic/claude-sonnet-4-6
    thinkingLevel: high
    tools: [read, bash, edit, write]
    skills: [test-driven-development]
    instructions: |
      Implement the approved plan and verify the result.
```

Each existing file has:

- `version`: required; must be integer `1`.
- `defaultMode`: optional at the individual-file level, but required in the final merged configuration.
- `modes`: required map with at least one entry.

Each mode has:

- `model`: required `provider/model-id` string. The first slash separates the provider; remaining slashes belong to the model ID.
- `tools`: required array of non-empty tool-name strings. The array itself may be empty; `mode_switch` is still added.
- `skills`: required array of non-empty discovered skill names. The array may be empty.
- `thinkingLevel`: optional; one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- `instructions`: optional non-empty string.

Unknown fields are rejected to catch configuration typos. Duplicate tool and skill names are normalized to their first occurrence while preserving order.

### Merge Semantics

Global and project files are parsed and structurally validated independently. Project modes replace same-named global modes as complete profiles; modes with other names are retained. A project `defaultMode` replaces the global value.

The merged result is valid only when `defaultMode` names a merged mode. If applying a structurally valid project file makes the merged configuration semantically invalid, the project file is ignored and the extension attempts to use the valid global result. A valid project file can also operate by itself when the global file is absent or invalid.

## Runtime Architecture

### Session Initialization

On `session_start`, the extension:

1. Loads and merges configuration.
2. Registers or refreshes `mode_switch`. A valid config produces an enum of configured names; without a valid config, the tool accepts a string only so it can return the configuration diagnostic instead of disappearing.
3. Reads the latest `mode-switch-state` custom entry from the current branch.
4. Chooses the restored mode if it still exists; otherwise chooses `defaultMode`.
5. Applies the chosen mode.
6. Updates footer status to `mode:<name>`.

If applying a restored mode fails, the extension attempts `defaultMode` when it is different. If default application also fails, pi's current model, thinking level, and tools remain unchanged and no active mode is reported.

On `session_tree`, state is restored from the newly selected branch using the same target-selection and application path.

### Shared Switch Operation

Both `/mode` and `mode_switch` call one controller operation:

```text
switch(name)
  → find configured mode
  → resolve provider/model in ctx.modelRegistry
  → verify every configured tool exists in pi.getAllTools()
  → construct tools = unique(configured tools + mode_switch)
  → call pi.setModel(model)
  → if model selection succeeds, set thinking level when configured
  → set active tools
  → commit active mode in memory
  → update footer status
  → append mode-switch-state to the session branch
```

All configuration, model, and tool checks happen before mutation. Model selection is the first mutation because it is the only application call that can report failure due to credentials. Thinking-level and active-tool changes occur only after it succeeds. Pi may clamp a configured thinking level to the selected model's supported levels; the extension accepts pi's effective result.

A startup or branch-restoration application does not append redundant state. Explicit command/tool switches append:

```json
{ "customType": "mode-switch-state", "data": { "mode": "code" } }
```

Custom entries do not enter model context and preserve branch-aware behavior.

### `/mode` Command

- `/mode code` switches directly.
- `/mode` opens `ctx.ui.select` when UI is available.
- In a non-UI mode, `/mode` without a name reports that a name is required.
- Argument completion returns configured mode names.
- Failures use `ctx.ui.notify`; success reports the active mode and updates footer status.

### `mode_switch` Tool

The custom tool:

- Uses a Google-compatible `StringEnum` built from configured mode names. If no valid config exists, it falls back to a string parameter and throws an error listing the expected YAML locations.
- Remains registered even when configuration is missing or invalid, so the agent always has a discoverable recovery path.
- Has `executionMode: "sequential"` because it mutates shared session runtime state.
- Includes available mode names in its description.
- Has a prompt snippet/guideline explaining that the agent should switch when another configured mode is a better fit.
- Returns the applied model, effective thinking level, active tools, and selected skills in text/details.
- Throws on failure so pi marks the tool result as an error.

The controller always adds `mode_switch` even when it is absent from YAML.

## Instructions and Skill Injection

Pi's `before_agent_start` event exposes `systemPromptOptions.skills`, including each discovered skill's name, path, and base directory. The extension caches this catalogue for the run.

Before every provider call, the `context` event appends one ephemeral custom message to the copied context. It contains:

- The active mode name.
- The mode's optional instructions.
- Its selected model, tools, and skill names.
- The full contents of every resolved selected `SKILL.md`.
- Each skill's absolute file path and base directory so relative references resolve correctly.

The ephemeral message is not appended to session history. Because `context` runs before every model request, a `mode_switch` tool call changes instructions and skills on the immediately following model turn, including within the same agent run.

Unselected skills remain normally discoverable in pi's base system prompt. This intentionally implements auto-loading, not a strict allow-list.

Only names from pi's discovered skill catalogue can resolve. YAML does not accept skill paths. Skill file reads are cached by path for the extension runtime and refreshed on pi `/reload`, which creates a new extension runtime.

## Error Handling

- Missing global or project file: allowed without warning.
- Both files missing: leave pi unchanged; `/mode` and `mode_switch` explain both expected locations.
- YAML parse or structural validation failure: emit a diagnostic naming the file and field; ignore that file.
- Unsupported config version or unknown field: reject that file.
- Untrusted project: do not read project YAML; global config remains available.
- Invalid merged default: ignore the project contribution when that recovers a valid global config; otherwise disable mode activation.
- Unknown mode: command reports available names; tool throws.
- Unknown model or tool: reject the switch before changing runtime state.
- Missing model credentials: `pi.setModel` failure leaves the previous active mode and its non-model settings unchanged.
- Unknown skill: warn once per mode/skill and omit only that skill from ephemeral context; the mode remains active.
- Skill read failure: warn once and omit that skill until reload.

Diagnostics use `ctx.ui.notify` when UI is available and `console.error` as a mode-independent fallback. Messages do not include skill contents or credentials.

## Security and Trust

- Project configuration is honored only for trusted projects.
- Skill resolution is limited to pi-discovered skills, which inherit pi's resource trust rules.
- Extensions and selected skills still run with pi's normal full permissions; the README includes pi's package security warning.
- A plan mode is not a security boundary because the user explicitly allows the agent to call `mode_switch` and enter another mode.
- Tool restrictions are implemented with `pi.setActiveTools`; this extension does not attempt shell-command allowlisting inside an enabled `bash` tool.

## Testing

Use Node's test runner through `tsx --test`, with `node:assert/strict` and no test framework dependency.

### Configuration tests

- Parse the documented example.
- Reject unsupported versions, unknown fields, malformed models, and missing required mode fields.
- Normalize duplicate tools and skills.
- Merge global/project files with full mode replacement.
- Handle project default override and invalid merged defaults.
- Ignore an invalid project file while retaining valid global configuration.
- Avoid reading project configuration when project trust is false.

### Controller tests

- Resolve `provider/model-id`, including model IDs containing slashes.
- Reject unknown modes, models, and tools before mutation.
- Always add `mode_switch` exactly once.
- Apply model before thinking/tools.
- Preserve active mode, thinking, and tools when `setModel` fails.
- Commit state only after a successful explicit switch.
- Restore branch state and fall back to the default mode.

### Skill tests

- Resolve selected skills by exact discovered name.
- Include full skill contents, path, and base directory.
- Preserve configured skill order.
- Leave unselected skills out of the auto-loaded block.
- Warn once for unknown or unreadable skills.
- Generate a new active-mode context immediately after controller state changes.

### Extension integration tests

Use a small fake `ExtensionAPI`/context harness to verify:

- `/mode` and `mode_switch` invoke the same controller.
- Tool parameters list configured mode names.
- The active tool is retained across profiles.
- Footer state and session entries update on success only.
- The README/example YAML remains accepted by the parser.

### Verification commands

```bash
npm test
npm run typecheck
```

After automated verification, run a local load smoke test with the installed pi CLI, using `pi -e .` in a way that does not require a paid model request. `/reload` behavior is checked interactively if a non-interactive command cannot exercise session startup safely.

## Acceptance Criteria

1. A valid global YAML applies its `defaultMode` to a new session.
2. A trusted project YAML can add modes, replace global modes, and override the default.
3. Resuming or navigating a branch restores that branch's last explicit mode.
4. `/mode` and `mode_switch` both switch model, thinking level, tools, instructions, and auto-loaded skills.
5. `mode_switch` remains active in every configured mode.
6. An agent-initiated switch changes the mode context on the next model request.
7. Invalid config, unknown runtime resources, and missing credentials do not leave a partially committed active mode.
8. Unknown skills are reported and omitted without disabling the mode.
9. Tests and type-checking pass.
10. README instructions cover package installation, both config locations, YAML schema, commands, tool behavior, trust, reload, and the fact that modes are not security boundaries.
