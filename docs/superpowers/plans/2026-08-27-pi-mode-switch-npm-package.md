# pi-mode-switch npm Package Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and publish `pi-mode-switch@0.1.0` as a Pi-installable npm package without changing extension behavior.

**Architecture:** Keep the existing TypeScript extension entry point and `pi` manifest. Harden only npm metadata and README installation instructions, then verify the exact npm tarball, commit the release changes without including the unrelated `.pi/modes.yaml` edit, push GitHub, and publish from the verified package root.

**Tech Stack:** TypeScript, Pi package manifest, npm, Git, Node.js test runner via `tsx`.

---

## Files and responsibilities

- Modify `package.json`: add public npm metadata while preserving package name, version, Pi manifest, dependencies, and tarball allowlist.
- Modify `README.md`: add npm installation and one-run usage while preserving local development usage and extension documentation.
- Create `docs/superpowers/specs/2026-08-27-pi-mode-switch-npm-package-design.md`: approved release design, already committed separately.
- Create `docs/superpowers/plans/2026-08-27-pi-mode-switch-npm-package.md`: this implementation plan.
- Do not modify `.pi/modes.yaml`: it contains an unrelated user working-tree change.
- Do not add tests: this change only edits package metadata and documentation; existing automated tests and tarball inspection verify the release.

### Task 1: Add npm package metadata

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm the current package identity and release version**

Run:

```bash
node -e "const p=require('./package.json'); console.log(JSON.stringify({name:p.name,version:p.version,pi:p.pi,files:p.files},null,2))"
```

Expected: package name `pi-mode-switch`, version `0.1.0`, extension path `./src/index.ts`, and files `src`, `README.md`, `modes.example.yaml`.

- [ ] **Step 2: Add public npm metadata**

Add these fields after `license` in `package.json`:

```json
"engines": {
  "node": ">=20"
},
"repository": {
  "type": "git",
  "url": "https://github.com/teristam/pi_mode_switch.git"
},
"bugs": {
  "url": "https://github.com/teristam/pi_mode_switch/issues"
},
"homepage": "https://github.com/teristam/pi_mode_switch#readme",
"publishConfig": {
  "access": "public"
},
```

Do not alter the existing `name`, `version`, `type`, `files`, `pi`, dependency, peer dependency, or script values.

- [ ] **Step 3: Validate JSON and metadata**

Run:

```bash
node -e "const p=require('./package.json'); if (p.name !== 'pi-mode-switch' || p.version !== '0.1.0' || p.publishConfig.access !== 'public' || p.engines.node !== '>=20') process.exit(1); console.log('package metadata OK')"
```

Expected: `package metadata OK`.

- [ ] **Step 4: Commit the metadata change**

Run:

```bash
git add package.json
git commit -m "chore: add npm release metadata"
```

Expected: one commit containing only `package.json`.

### Task 2: Document npm installation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add npm installation instructions**

Replace the existing installation section with:

```markdown
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
```

Keep the remainder of the README unchanged.

- [ ] **Step 2: Check the documentation diff**

Run:

```bash
git diff -- README.md
```

Expected: only the install section changes, and both npm commands use the `npm:pi-mode-switch` Pi package source syntax.

- [ ] **Step 3: Commit the README change**

Run:

```bash
git add README.md
git commit -m "docs: document npm installation"
```

Expected: one commit containing only `README.md`.

### Task 3: Verify the release artifact

**Files:**
- No source changes.

- [ ] **Step 1: Run the full automated test suite**

Run:

```bash
npm test
```

Expected: 49 tests pass, 0 failures.

- [ ] **Step 2: Run TypeScript validation**

Run:

```bash
npm run typecheck
```

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 3: Inspect npm's dry-run file list**

Run:

```bash
npm pack --dry-run --json
```

Expected: the package is `pi-mode-switch@0.1.0`, and the file list is exactly:

```text
README.md
modes.example.yaml
package.json
src/config.ts
src/index.ts
src/mode-controller.ts
src/mode-editor.ts
src/skills.ts
src/types.ts
```

The list must not contain `.pi/modes.yaml`, tests, `node_modules`, or planning documents.

- [ ] **Step 4: Create and inspect the real tarball**

Run:

```bash
PACK=$(npm pack --silent)
tar -tzf "$PACK"
rm "$PACK"
```

Expected: the archive contains the same nine intended package files under the `package/` prefix, then the generated `.tgz` is removed.

- [ ] **Step 5: Check release diff and unrelated working-tree state**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the pre-existing `.pi/modes.yaml` modification is uncommitted.

### Task 4: Push GitHub and publish to npm

**Files:**
- No source changes.

- [ ] **Step 1: Record the release commit and verify the branch**

Run:

```bash
git log -3 --oneline
git status --short --branch
```

Expected: the latest commits are the npm metadata and README commits, and `.pi/modes.yaml` remains the only unrelated local modification.

- [ ] **Step 2: Push the release commits to GitHub**

Run:

```bash
git push origin master
```

Expected: `origin/master` advances to include the release-hardening commits.

- [ ] **Step 3: Verify npm authentication without exposing credentials**

Run:

```bash
npm whoami
```

Expected: the configured npm username. If npm reports `ENEEDAUTH`, stop publication and report that the user must run `npm login` in the terminal before retrying; never request or print a token.

- [ ] **Step 4: Publish the verified package**

Run:

```bash
npm publish
```

Expected: npm publishes `pi-mode-switch@0.1.0` with public access.

- [ ] **Step 5: Verify registry metadata**

Run:

```bash
npm view pi-mode-switch version dist-tags --json
```

Expected JSON includes version `0.1.0` and `latest` pointing to `0.1.0`.

- [ ] **Step 6: Smoke-test Pi package installation**

Run:

```bash
pi install npm:pi-mode-switch@0.1.0
pi list
```

Expected: Pi installs the package and lists `npm:pi-mode-switch@0.1.0` as an installed package. If this changes user settings, report that explicitly.

- [ ] **Step 7: Final verification**

Run:

```bash
npm test && npm run typecheck && git diff --check && git status --short --branch
```

Expected: tests and typecheck exit successfully, no whitespace errors, and the unrelated `.pi/modes.yaml` edit remains uncommitted.
