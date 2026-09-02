# Mode Entry Behavior

## Goal

Keep mode editing and mode cycling as separate interactions:

- Bare `/mode` opens the TUI mode settings flow.
- `/mode <name>` continues to switch directly to the named configured mode.
- `Ctrl+M` cycles through configured modes in YAML order.

## Design

The extension command handler treats `args.trim()` as the routing decision. An empty argument opens `editModeConfig(ctx)` and does not activate or persist a mode. A non-empty argument retains the existing direct activation path and its validation/error reporting.

The `Ctrl+M` shortcut remains responsible for cycling. It uses the active mode's position in the configured mode-name order, activates the next mode, persists the branch-aware state, and reports failures without opening the editor.

No mode-editor UI changes are required. The change is focused on preserving and documenting the entry-point split, with a regression test covering the bare `/mode` route.

## Verification

- Add a test that registers the command and stubs the TUI editor flow, then invokes the command with blank arguments and verifies the editor path is entered without a mode-switch entry.
- Preserve existing tests for direct `/mode <name>` switching and `Ctrl+M` cycling.
- Run the complete test suite and TypeScript typecheck.
