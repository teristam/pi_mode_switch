# GitHub Release npm Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish future `pi-mode-switch` versions to npm automatically after a matching GitHub Release is published, using npm Trusted Publishing.

**Architecture:** Add one GitHub Actions workflow triggered only by `release.published`. The job checks out the exact release tag, installs Node.js 24, installs locked dependencies, runs the existing tests and typecheck, verifies that the tag version matches `package.json`, and publishes with OIDC-backed npm Trusted Publishing. Document the release steps and one-time npm trust configuration in the README.

**Tech Stack:** GitHub Actions, npm Trusted Publishing/OIDC, Node.js 24, TypeScript, npm.

---

## Files and responsibilities

- Create `.github/workflows/publish.yml`: release-triggered CI validation and npm publication.
- Modify `README.md`: document version/tag conventions, GitHub Release creation, and npm Trusted Publisher setup.
- Create `docs/superpowers/specs/2026-08-28-github-release-npm-publishing-design.md`: approved design, already committed separately.
- Create `docs/superpowers/plans/2026-08-28-github-release-npm-publishing.md`: this implementation plan.
- Do not modify `.pi/modes.yaml`: it is an unrelated existing working-tree change.
- Do not add application tests: the change consists of GitHub Actions and documentation configuration; validation will parse the workflow and run the existing test suite/typecheck.

### Task 1: Add the Trusted Publishing workflow

**Files:**
- Create: `.github/workflows/publish.yml`

- [ ] **Step 1: Create the workflow with the exact release trigger and permissions**

Create `.github/workflows/publish.yml` with:

```yaml
name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    name: Test and publish package
    runs-on: ubuntu-latest
    steps:
      - name: Check out release tag
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm ci

      - name: Verify release version
        shell: bash
        env:
          RELEASE_TAG: ${{ github.event.release.tag_name }}
        run: |
          tag_version="${RELEASE_TAG#v}"
          package_version="$(node -p "require('./package.json').version")"
          if [ "$tag_version" != "$package_version" ]; then
            echo "Release tag $RELEASE_TAG does not match package version $package_version"
            exit 1
          fi
          echo "Publishing package version $package_version from tag $RELEASE_TAG"

      - name: Run tests
        run: npm test

      - name: Run typecheck
        run: npm run typecheck

      - name: Publish package
        run: npm publish --provenance --access public
```

The workflow must not define `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or any long-lived npm secret. `id-token: write` is the authentication permission used by npm Trusted Publishing.

- [ ] **Step 2: Validate workflow YAML syntax and required fields**

Run:

```bash
node --input-type=module -e "import { readFile } from 'node:fs/promises'; import { parse } from 'yaml'; const text = await readFile('.github/workflows/publish.yml', 'utf8'); const workflow = parse(text); if (!workflow.jobs?.publish || !workflow.permissions?.['id-token'] || workflow.permissions['id-token'] !== 'write' || workflow.jobs.publish.steps.at(-1)?.run !== 'npm publish --provenance --access public') process.exit(1); console.log('workflow structure OK')"
```

Expected: `workflow structure OK`.

- [ ] **Step 3: Check the workflow for forbidden token authentication**

Run:

```bash
if rg -n "NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.NPM" .github/workflows/publish.yml; then exit 1; else echo "no long-lived npm token configured"; fi
```

Expected: `no long-lived npm token configured`.

- [ ] **Step 4: Commit the workflow**

Run:

```bash
git add .github/workflows/publish.yml
git commit -m "ci: publish npm package from GitHub releases"
```

Expected: one commit containing only `.github/workflows/publish.yml`.

### Task 2: Document the release process

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add release instructions**

Add this section after `## Develop`:

```markdown
## Release

To publish a new version:

1. Update `version` in `package.json` and commit the change.
2. Push the commit to `master`.
3. On GitHub, choose **Releases → Draft a new release**.
4. Create a tag named `v<version>`—for example, `v0.1.1` for package version `0.1.1`.
5. Add release notes and select **Publish release**.

Publishing the GitHub Release starts `.github/workflows/publish.yml`. The workflow checks out that tag, runs tests and typecheck, verifies the tag matches `package.json`, and publishes the package to npm.

Before the first automated release, configure npm Trusted Publishing for `pi-mode-switch` with:

- GitHub owner: `teristam`
- Repository: `pi_mode_switch`
- Workflow file: `publish.yml`
- Environment: none

Pushing a tag without publishing a GitHub Release does not publish to npm. npm versions are immutable, so each release needs a new package version.
```

- [ ] **Step 2: Inspect the README diff**

Run:

```bash
git diff -- README.md
```

Expected: the only README change is the new `Release` section, and the existing installation/configuration/development instructions remain unchanged.

- [ ] **Step 3: Commit the documentation**

Run:

```bash
git add README.md
git commit -m "docs: explain automated npm releases"
```

Expected: one commit containing only `README.md`.

### Task 3: Verify the complete change

**Files:**
- No additional source changes.

- [ ] **Step 1: Run the existing test suite**

Run:

```bash
npm test
```

Expected: 49 tests pass with 0 failures.

- [ ] **Step 2: Run TypeScript validation**

Run:

```bash
npm run typecheck
```

Expected: exit code 0 with no diagnostics.

- [ ] **Step 3: Re-validate workflow semantics**

Run:

```bash
node --input-type=module -e "import { readFile } from 'node:fs/promises'; import { parse } from 'yaml'; const text = await readFile('.github/workflows/publish.yml', 'utf8'); const workflow = parse(text); const steps = workflow.jobs.publish.steps; const runs = steps.filter((step) => typeof step.run === 'string').map((step) => step.run); if (workflow.on.release.types[0] !== 'published' || workflow.permissions.contents !== 'read' || workflow.permissions['id-token'] !== 'write' || !steps.some((step) => step.uses === 'actions/checkout@v4' && step.with.ref.includes('github.event.release.tag_name')) || !steps.some((step) => step.uses === 'actions/setup-node@v4' && step.with['node-version'] === 24) || !runs.includes('npm ci') || !runs.includes('npm test') || !runs.includes('npm run typecheck') || !runs.includes('npm publish --provenance --access public')) process.exit(1); console.log('release workflow requirements OK')"
git diff --check
```

Expected: `release workflow requirements OK` and no whitespace errors.

- [ ] **Step 4: Confirm only the intended changes are committed**

Run:

```bash
git status --short --branch
git diff origin/master..HEAD --name-status
```

Expected: `.pi/modes.yaml` remains the only uncommitted path; the release branch changes contain the workflow, README section, and workflow design/plan documentation.

### Task 4: Push the workflow and configure Trusted Publishing

**Files:**
- No additional source changes.

- [ ] **Step 1: Push the commits to GitHub**

Run:

```bash
git push origin master
```

Expected: GitHub receives the workflow before any future release is published.

- [ ] **Step 2: Configure npm Trusted Publishing in the npm website**

In npm package settings for `pi-mode-switch`, add a GitHub Actions trusted publisher with:

```text
Organization/user: teristam
Repository: pi_mode_switch
Workflow filename: publish.yml
Environment: none
```

Save the setting. No npm token is added to GitHub secrets.

- [ ] **Step 3: Verify the committed workflow is on origin**

Run:

```bash
git ls-remote origin refs/heads/master
```

Expected: the remote commit matches the local `master` HEAD.

A real publication should be tested by bumping `package.json` to a new version, pushing it, and publishing a matching GitHub Release. Do not reuse `0.1.0`, because npm already contains that immutable version.
