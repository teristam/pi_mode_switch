# GitHub Release npm Publishing Design

**Date:** 2026-08-28

## Goal

Publish future `pi-mode-switch` npm versions automatically when a GitHub Release is published, using npm Trusted Publishing instead of a long-lived npm token.

## Trigger and versioning

The workflow listens only for GitHub's `release` event with `types: [published]`. Creating or pushing a tag alone does not publish.

Each release must use a tag whose version matches `package.json` after removing the optional leading `v`:

- `package.json`: `0.1.1`
- GitHub Release tag: `v0.1.1`

The workflow checks this match before running npm publish and fails safely if it does not match. Reusing an already-published npm version fails as expected because npm versions are immutable.

## Workflow

Create `.github/workflows/publish.yml` with these steps:

1. Check out the exact GitHub Release tag.
2. Install Node.js 24, which supplies a current npm CLI compatible with Trusted Publishing.
3. Run `npm ci`.
4. Run `npm test`.
5. Run `npm run typecheck`.
6. Verify the release tag matches the package version.
7. Publish with `npm publish --provenance --access public`.

The job has only `contents: read` and `id-token: write` permissions. It does not use `NPM_TOKEN` or print credentials.

## One-time npm configuration

The npm package settings must define a GitHub Actions trusted publisher:

- Owner: `teristam`
- Repository: `pi_mode_switch`
- Workflow filename: `publish.yml`
- Environment: none

The workflow file name and repository identity are part of the trust relationship and must remain aligned with npm's configuration.

## Documentation

Add a short `Release` section to `README.md` explaining the version/tag rule, the GitHub Release trigger, and the one-time npm Trusted Publisher setup. Existing installation and development instructions remain unchanged.

## Verification

Validate the workflow YAML structure, run the existing test suite and typecheck, inspect the final diff, and confirm the release workflow contains the required trigger, permissions, exact-tag checkout, version guard, tests, and publish command. Do not simulate a GitHub Release locally or publish another npm version from this change.
