# Tagged npm Publishing Design

**Date:** 2026-08-31

## Goal

Publish future `pi-mode-switch` npm versions automatically when a matching version tag is pushed, using npm Trusted Publishing instead of a long-lived npm token.

## Trigger and versioning

The workflow listens only for pushes of tags matching `v*`:

```yaml
on:
  push:
    tags: ['v*']
```

A release must update `package.json` before the tag is created. The pushed tag must be `v<version>`, and the version must match after removing the leading `v`:

- `package.json`: `0.1.2`
- pushed Git tag: `v0.1.2`

The workflow checks this match before publishing and fails safely for mismatched tags. npm versions are immutable, so retrying a tag for an already-published version fails rather than overwriting it.

GitHub Releases are optional metadata and are not required to publish. Pushing the tag is the publication trigger.

## Workflow

Update `.github/workflows/publish.yml` with these steps:

1. Trigger on a pushed `v*` tag.
2. Check out the commit associated with the pushed tag.
3. Install Node.js 24 and configure the npm registry.
4. Run `npm ci`.
5. Verify that `github.ref_name` without a leading `v` equals `package.json`'s version.
6. Run `npm test`.
7. Run `npm run typecheck`.
8. Publish with `npm publish --provenance --access public`.

The job has only `contents: read` and `id-token: write` permissions. It does not define `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or any long-lived npm secret. npm Trusted Publishing uses the GitHub Actions OIDC token.

The workflow should use `github.ref_name` for both the version check and release diagnostics. `actions/checkout` may use its default ref because a tag-push event checks out the pushed commit; explicitly checking out `${{ github.ref }}` is also acceptable if the exact tag ref is desired.

## One-time npm configuration

The npm package settings must define a GitHub Actions trusted publisher:

- Owner: `teristam`
- Repository: `pi_mode_switch`
- Workflow filename: `publish.yml`
- Environment: none

The workflow filename and repository identity are part of the trust relationship and must remain aligned with npm's configuration.

## Documentation

Update the `Release` section of `README.md` to explain this sequence:

1. Update `version` in `package.json` and commit the change.
2. Push the commit to `master`.
3. Create a matching tag, such as `git tag v0.1.2`.
4. Push the tag with `git push origin v0.1.2`.

Explain that the tag push starts `.github/workflows/publish.yml`, which validates the tag, runs tests and typecheck, and publishes to npm. State that creating a GitHub Release is optional and does not itself trigger a separate publish.

## Verification

Validate the workflow structure and required tag trigger, run the existing test suite and typecheck, run `npm pack --dry-run`, inspect the final diff, and confirm the workflow contains the required permissions, version guard, tests, and publish command. Do not simulate a GitHub Actions run or publish another npm version from this change.
