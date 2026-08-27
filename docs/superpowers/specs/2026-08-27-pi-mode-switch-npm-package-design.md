# pi-mode-switch npm Package Release Design

**Date:** 2026-08-27

## Goal

Publish the existing pi extension as the public npm package `pi-mode-switch@0.1.0`, so users can install it with Pi's package manager using `pi install npm:pi-mode-switch`.

## Scope

This release is packaging and documentation hardening only. It does not change extension behavior, YAML parsing, mode activation, skill triggers, or the TUI editor.

## Package shape

The package keeps the current TypeScript entry point and Pi manifest:

- `src/index.ts` remains the extension entry point.
- `package.json.pi.extensions` continues to expose `./src/index.ts`.
- `yaml` remains a runtime dependency.
- Pi core packages remain peer dependencies and development dependencies.
- The npm tarball allowlist continues to include only `src`, `README.md`, and `modes.example.yaml`, in addition to npm's required `package.json`.

The package must not include tests, local `.pi` configuration, documentation planning artifacts, or installed dependencies.

## Metadata

`package.json` will add standard public-package metadata without changing the package name or version:

- `engines.node` requiring Node.js 20 or newer.
- `repository` pointing to `https://github.com/teristam/pi_mode_switch.git`.
- `bugs` pointing to the repository issue tracker.
- `homepage` pointing to the GitHub repository.
- `publishConfig.access` set to `public` for an unscoped package.

## Documentation

`README.md` will document both supported npm flows:

```bash
pi install npm:pi-mode-switch
pi -e npm:pi-mode-switch
```

The local checkout flow remains documented for development and verification. The configuration, switching, skill-trigger, security, and development sections remain intact.

## Verification

Before publication:

1. Run `npm test`.
2. Run `npm run typecheck`.
3. Run `npm pack --dry-run --json` and confirm the tarball contains only the intended nine files.
4. Run `npm pack`, inspect the archive contents, and remove the generated tarball if needed.
5. Confirm `npm whoami` succeeds before attempting publication.

Publication uses:

```bash
npm publish
```

After publication, verify the registry metadata and Pi installation path:

```bash
npm view pi-mode-switch version dist-tags --json
pi install npm:pi-mode-switch@0.1.0
pi list
```

If npm authentication is unavailable, all local release preparation and GitHub changes may still be completed, but publication must stop with the exact authentication requirement rather than exposing credentials.

## GitHub integration

The release-hardening changes will be committed on the current branch and pushed to the configured `origin` remote. The existing unrelated working-tree change in `.pi/modes.yaml` must remain untouched and must not be included in the release commit.
