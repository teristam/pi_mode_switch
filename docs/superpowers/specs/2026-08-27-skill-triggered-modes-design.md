# Skill-Triggered Modes Design

**Date:** 2026-08-27
**Status:** Approved

## Summary

Extend `pi-mode-switch` so a discovered Pi skill can automatically activate a configured mode before the skill runs. Each mode may declare an independent `triggerSkills` list. The extension detects both explicit `/skill:name` commands and agent-initiated reads of a discovered skill's `SKILL.md`, then routes the switch through the existing mode activation and branch-persistence path.

Automatic activation is persistent, just like `/mode <name>` and `mode_switch`. If activation fails, the skill invocation is blocked rather than running under the wrong mode.

## Goals

- Map discovered skill names to destination modes in YAML.
- Trigger on explicit `/skill:name` commands before Pi expands them.
- Trigger when the agent reads the exact `SKILL.md` of a discovered skill.
- Apply the destination model, thinking level, tools, instructions, and auto-loaded skills before subsequent skill work.
- Persist successful automatic switches as branch-aware mode state.
- Configure trigger skills through the `/mode` TUI editor.
- Preserve the existing allow/deny-list behavior for tools and auto-loaded skills.
- Provide deterministic validation, actionable failures, documentation, and automated tests.

## Non-goals

- Treating every auto-loaded `skills` or `excludeSkills` entry as a trigger.
- Triggering on reference files, scripts, or assets inside a skill directory.
- Inferring skill use from natural-language assistant output.
- Restoring the previous mode automatically when a skill finishes.
- Cancelling sibling tool calls already issued in the same assistant tool batch.
- Turning modes into a security or sandbox boundary.

## YAML Configuration

`triggerSkills` is an optional mode field:

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
      Analyze and plan without modifying project files.

  code:
    model: anthropic/claude-sonnet-4-6
    thinkingLevel: high
    tools: [read, bash, edit, write]
    skills: [test-driven-development, verification-before-completion]
    triggerSkills: [test-driven-development]
```

### Field semantics

- `triggerSkills` may be omitted or supplied as an array of non-empty skill-name strings.
- Duplicate names within one list are normalized to their first occurrence, preserving order.
- A skill may target at most one mode in a parsed source and in the final merged configuration.
- `triggerSkills` is independent from `skills` and `excludeSkills`. The latter fields continue to control which skill instructions are auto-loaded into active-mode context.
- Configured names are resolved against Pi's discovered skill catalogue at runtime. Unknown names remain inert and produce a warning once the catalogue is available.

### Merge and fallback behavior

Project modes continue to replace same-named global modes as complete profiles. Trigger ownership is validated after replacement and merge.

If a project contribution creates an ambiguous trigger mapping, loading follows the existing fallback policy: report the merged-config diagnostic and retain a valid global configuration when possible. An invalid global source does not prevent a valid standalone project configuration from loading.

## Runtime Architecture

### Shared trigger lookup

After configuration loads, `src/index.ts` builds a `skill name -> mode name` lookup from all `triggerSkills` entries. Both trigger sources call one helper that:

1. Finds the configured destination mode.
2. Returns immediately when that mode is already active.
3. Calls the existing `activate(mode, ctx, true)` operation.
4. Updates footer state and appends the existing `mode-switch-state` custom entry only after success.
5. Reports whether a real switch occurred so callers can avoid duplicate notifications and state.

The persisted entry shape remains unchanged:

```json
{ "customType": "mode-switch-state", "data": { "mode": "code" } }
```

### Explicit skill commands

Pi emits `input` after extension-command dispatch but before skill expansion. The extension adds an `input` handler that:

1. Recognizes only exact command syntax beginning with `/skill:<name>`, with optional arguments after whitespace.
2. Confirms that `pi.getCommands()` contains the corresponding command with `source: "skill"`. This avoids switching for unknown commands or an extension command that merely resembles a skill command.
3. Looks up the configured target mode.
4. Activates and persists the target before returning `{ action: "continue" }`.
5. Leaves the original text and arguments unchanged so Pi performs its normal skill expansion.

The first provider request for the expanded skill therefore uses the destination mode.

If activation fails, the handler reports the error and returns `{ action: "handled" }`, preventing the skill from running under the previous mode.

### Agent-initiated skill reads

`before_agent_start` already receives Pi's discovered `Skill[]` catalogue. `SkillContextBuilder` will retain an exact normalized path lookup in addition to its existing name lookup.

A `tool_call` handler for `read` will:

1. Strip the built-in tool's accepted leading `@` path marker.
2. Resolve relative input against `ctx.cwd` and normalize the path consistently with the platform.
3. Require an exact match with a discovered skill's `filePath`.
4. Look up and activate the skill's configured destination mode.
5. Return without blocking on success, allowing the original read to execute.

Only the discovered `SKILL.md` path triggers a switch. Reads of a skill's references, scripts, assets, similarly named files, or ordinary project files do not.

The switch occurs during tool preflight. The current read still executes, and the next provider request receives the new model, tools, instructions, and ephemeral mode context. Sibling tool calls already emitted in the same assistant message are not retroactively cancelled; this is consistent with modes being workflow profiles rather than sandboxes.

If activation fails, the handler returns `{ block: true, reason }`, so Pi records an error result instead of exposing the skill contents under the wrong mode.

### Path handling

The path lookup uses Node path resolution/normalization and platform-appropriate case handling. Pi-provided discovered paths are treated as canonical identities for matching; the feature does not trigger for arbitrary files merely located beneath the same skill base directory.

## TUI Mode Editor

`src/mode-editor.ts` adds a `Trigger skills` multi-select populated from the same discovered skill names already used by the skills selectors.

Editor behavior:

- Existing `triggerSkills` values are cloned and displayed.
- Saving a changed selection writes the field through `serializeModeConfig()`.
- Omitted fields remain omitted when an existing mode is edited without changing triggers.
- New modes begin without triggers unless the user selects them.
- Serialization includes only editable YAML fields and never writes normalized runtime fields such as `provider` or `modelId`.

## Error Handling

- Malformed `triggerSkills`: reject the source with a path-and-field diagnostic.
- Duplicate trigger target across modes: reject the ambiguous source or merged contribution.
- Unknown configured skill: warn once after discovery; do not disable the mode configuration.
- Explicit activation failure: notify/report and consume the command so the skill does not run.
- Agent-read activation failure: block the read with the controller error.
- Already-active target: allow the skill, with no model reset, notification noise, or duplicate state entry.
- Unknown/unmapped skill: preserve Pi's normal behavior without switching.
- Failed switches append no session state and retain the controller's existing partial-mutation protections.

Diagnostics do not expose skill contents, credentials, or unrelated configuration.

## Documentation

Update:

- `README.md` with field semantics, trigger sources, persistence, failures, and the workflow-not-sandbox limitation.
- `modes.example.yaml` with representative `triggerSkills` entries.
- The `/mode` editor description to mention trigger selection.

Project-local trigger configuration remains subject to Pi project trust through the existing config loader.

## Testing

### Configuration tests

- Parse and normalize `triggerSkills`.
- Reject non-array, empty-string, and ambiguous cross-mode entries.
- Preserve trigger fields through full project-mode replacement.
- Reject a merge-created conflict and retain valid global fallback configuration.
- Keep `modes.example.yaml` valid.

### Skill/path tests

- Resolve an exact discovered `SKILL.md` from absolute and cwd-relative read paths.
- Handle the built-in leading `@` marker and platform path normalization.
- Do not match skill reference files, sibling paths, or ordinary files.
- Warn once for configured trigger names absent from the catalogue.

### Extension integration tests

- An explicit mapped `/skill:name` activates and persists the target before returning `continue`.
- Explicit arguments remain untouched for Pi expansion.
- Unknown and unmapped commands do not switch.
- An already-active target adds no session entry.
- Explicit activation failure returns `handled`.
- A mapped skill-file read activates and persists before the read proceeds.
- A failed read-trigger activation returns a blocking result.
- The immediately following context event contains the new active mode.
- Existing command/tool switching and branch restoration continue to work.

### Editor tests

- Serialize and parse `triggerSkills` without runtime-only fields.
- Preserve trigger selections alongside allow and deny lists.
- Omit absent trigger fields rather than inventing them.

### Verification commands

```bash
npm test
npm run typecheck
npm pack --dry-run
pi -e . --list-models > /dev/null
```

## Acceptance Criteria

1. A mapped `/skill:name` command switches modes before its first provider call.
2. Reading the exact discovered `SKILL.md` switches modes before the read executes and affects the next provider call.
3. Successful automatic switches persist and restore through existing branch-aware state.
4. Failed automatic switches block the skill and append no state.
5. Already-active, unknown, and unmapped skills do not cause redundant or accidental switches.
6. `triggerSkills` remains independent from skill auto-loading allow/deny lists.
7. Ambiguous mappings are rejected deterministically with existing global/project fallback behavior.
8. The TUI editor, README, and example configuration expose the feature.
9. Existing tests, new trigger tests, type-checking, packaging, and smoke loading pass.
