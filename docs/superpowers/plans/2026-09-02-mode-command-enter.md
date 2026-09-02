# Mode Command Enter-Key Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the mode-cycle shortcut from consuming Enter so bare `/mode` reaches the TUI mode editor.

**Architecture:** Keep the existing `/mode` command and mode editor unchanged. Change only the cycling shortcut from `Ctrl+M`, which is indistinguishable from Enter in legacy terminal input, to `Ctrl+Alt+M`, whose legacy sequence is distinct. Extend the existing integration coverage with a real key-matching assertion.

**Tech Stack:** TypeScript, Node test runner via `tsx`, Pi extension APIs, `@earendil-works/pi-tui` key matching.

---

### Task 1: Add failing shortcut regression coverage

**Files:**
- Modify: `test/index.test.ts:1,158-168`

- [ ] **Step 1: Update the integration test to expect the safe shortcut**

Import `Key` and `matchesKey` from `@earendil-works/pi-tui`, change the registered shortcut lookup from `ctrl+m` to `ctrl+alt+m`, and add the raw-terminal collision assertion:

```ts
import { Key, matchesKey } from "@earendil-works/pi-tui";
```

Change:

```ts
const cycleShortcut = shortcuts.get("ctrl+m");
```

to:

```ts
const cycleShortcut = shortcuts.get("ctrl+alt+m");
```

Add this test after the integration test:

```ts
test("mode cycle shortcut does not consume Enter", () => {
  assert.equal(matchesKey("\r", Key.ctrl("m")), true);
  assert.equal(matchesKey("\r", Key.ctrlAlt("m")), false);
  assert.equal(matchesKey("\x1b\r", Key.ctrlAlt("m")), true);
});
```

The first assertion records the original collision, the second proves Enter is safe with the replacement, and the third verifies the legacy Ctrl+Alt+M sequence remains usable.

- [ ] **Step 2: Run the focused tests and verify the regression fails for the old registration**

Run:

```bash
npm test -- test/index.test.ts
```

Expected: FAIL in `command and tool share switching...` because the current implementation still registers `ctrl+m`, while the new test also passes its direct key-matching assertions. Do not change production code until this failure is observed.

### Task 2: Change the registered shortcut and documentation

**Files:**
- Modify: `src/index.ts:198`
- Modify: `README.md:59`

- [ ] **Step 1: Register cycling on Ctrl+Alt+M**

Replace only the shortcut registration key in `src/index.ts`:

```ts
pi.registerShortcut(Key.ctrl("m"), {
```

with:

```ts
pi.registerShortcut(Key.ctrlAlt("m"), {
```

Keep the existing handler body unchanged so mode ordering, activation, persistence, status updates, and error reporting do not change.

- [ ] **Step 2: Document the replacement key**

Replace the README shortcut bullet:

```md
- `Ctrl+M` cycles through configured modes in YAML order.
```

with:

```md
- `Ctrl+Alt+M` cycles through configured modes in YAML order.
```

- [ ] **Step 3: Run the focused tests and verify they pass**

Run:

```bash
npm test -- test/index.test.ts
```

Expected: all tests in `test/index.test.ts` pass, including bare `/mode` opening the editor path and the new shortcut registration/key-collision coverage.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/index.ts README.md test/index.test.ts
git commit -m "fix: keep mode shortcut from consuming enter"
```

### Task 3: Complete verification

**Files:**
- Inspect: `src/index.ts`, `README.md`, `test/index.test.ts`

- [ ] **Step 1: Run the complete test suite**

```bash
npm test
```

Expected: all tests pass with no failures or unhandled errors.

- [ ] **Step 2: Run TypeScript validation**

```bash
npm run typecheck
```

Expected: `tsc --noEmit` exits successfully.

- [ ] **Step 3: Verify package contents**

```bash
npm pack --dry-run
```

Expected: packaging succeeds and includes the extension source, README, and bundled `modes.yaml`.

- [ ] **Step 4: Check the final diff and working tree**

```bash
git diff --check HEAD^ HEAD
git status --short --branch
git log --oneline -3
```

Expected: the latest implementation commit contains only the shortcut source change, README wording, and regression test; the working tree is clean apart from any intentionally ignored local files.
