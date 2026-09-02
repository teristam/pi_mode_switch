# Model selector API compatibility fix

## Problem

Opening the `/mode` editor throws `TypeError: this.modelRuntime.getAvailableSnapshot is not a function`. The installed `@earendil-works/pi-coding-agent@0.84.4` expects `ModelSelectorComponent` arguments in this order:

```ts
(tui, currentModel, modelRuntime, scopedModels, onSelect, onCancel, ...)
```

The working tree currently calls the older `0.84.2` shape and passes `SettingsManager.inMemory()` before the model runtime adapter. The selector therefore receives a settings manager as `modelRuntime`.

## Design

Use the current `0.84.4+` selector constructor. Keep `createModelSelectorRuntime`, which adapts the extension-facing synchronous `ModelRegistry` methods (`getAvailable`, `find`, `refresh`, and `getError`) to the runtime methods consumed by the built-in selector.

The mode editor will:

1. Resolve the current `provider/model-id` into a registry model when possible.
2. Pass the adapted runtime as the third constructor argument.
3. Pass `ctx.scopedModels` as the fourth argument.
4. Convert the selected model back to `provider/id` before completing the submenu.
5. Complete without a value on cancellation.

`SettingsManager` will no longer be imported or created. YAML serialization, validation, mode switching, and persistence remain unchanged.

## Dependency alignment

Update the development versions of the Pi peer packages from `^0.84.2` to `^0.84.4` and refresh the lockfile. The peer dependency ranges remain unchanged because the extension targets the installed current API rather than pinning consumers.

## Error handling

The selector continues to own model catalog refresh and displays its cached-model fallback/status messages. The adapter forwards refresh options and registry errors without changing them. Existing mode-editor validation remains responsible for rejecting malformed model references when saving.

## Testing

Add a regression test that constructs the built-in selector with the adapted runtime using the current constructor shape; this must fail while the obsolete settings-manager argument remains. Retain the adapter behavior tests for snapshot lookup, model lookup, refresh forwarding, and error forwarding. Run the focused tests, full test suite, typecheck, and package dry run.

## Scope

Only the selector integration, its dependency metadata, and regression coverage are in scope. Do not add dual-version constructor detection or replace the built-in selector with a custom text editor.
