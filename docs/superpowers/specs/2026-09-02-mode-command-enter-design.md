# Mode Command Enter-Key Fix

## Goal

Make bare `/mode` reach the TUI mode editor while preserving keyboard mode cycling.

## Root Cause

The extension registered cycling on `Key.ctrl("m")`. In legacy terminals, Ctrl+M is encoded as carriage return (`\r`), which is also the Enter key. Pi dispatches extension shortcuts before the editor submits input, so pressing Enter while typing `/mode` activated the cycle handler and prevented the command from being submitted.

## Design

Register cycling on `Key.ctrlAlt("m")` instead. Its legacy terminal sequence is `Esc` followed by carriage return, so it does not match ordinary Enter. The existing cycle handler, mode activation, persistence, status updates, and failure reporting remain unchanged. The `/mode` command routing and editor UI also remain unchanged.

Update the README and integration test to expose the new shortcut. Add a key-matching regression assertion proving that raw Enter is not intercepted while the legacy Ctrl+Alt+M sequence is accepted.

## Verification

- Focused index tests, including the bare `/mode` editor route and shortcut behavior.
- Complete test suite.
- TypeScript typecheck.
- `git diff --check`.
