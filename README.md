# Bootstrap-ng

[![VS Code Marketplace version](https://badgen.net/vs-marketplace/v/coliff.bootstrap-ng?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=coliff.bootstrap-ng)
[![VS Code Marketplace installs](https://badgen.net/vs-marketplace/i/coliff.bootstrap-ng)](https://marketplace.visualstudio.com/items?itemName=coliff.bootstrap-ng)
[![Open VSX version](https://img.shields.io/open-vsx/v/coliff/bootstrap-ng?label=Open%20VSX)](https://open-vsx.org/extension/coliff/bootstrap-ng)
[![Open VSX downloads](https://img.shields.io/open-vsx/dt/coliff/bootstrap-ng)](https://open-vsx.org/extension/coliff/bootstrap-ng)

Editor support for [bootstrap-ng](https://bootstrap-ng.com/), the Angular components for Bootstrap 6.

Commands, settings, diagnostics, hovers, and the import quick fix follow the VS Code display language for English, French, German, Italian, Japanese and Spanish. Snippet templates and API descriptions from the bootstrap-ng docs stay in English.

## Features

- Warnings in the Problems panel when `package.json` depends on `bootstrap` or `bootstrap-ng` `6.0.0-alpha.1`, with a quick fix that updates the version to `6.0.0-alpha.2`.
- Completions for `bs*` directives, their inputs and outputs, and documented values such as `theme` and `bsButton="outline"`, in HTML templates and inline Angular `template` strings.
- Completions and hovers for Bootstrap 6 CSS classes in `class` attributes, including responsive variants such as `sm:d-flex` and `md:col-6`.
- Completions for `bootstrap-ng` imports.
- Hovers with a short description and a link to the docs.
- Snippets for common components and form controls (`bs-alert`, `bs-dialog`, `bs-form-field`, and others).
- Warnings when a static attribute value is outside the documented set, with a quick fix for close matches such as `theme="primray"` to `theme="primary"`.
- Information hints for Bootstrap 5 `data-bs-toggle` and `data-bs-dismiss` attributes, naming the bootstrap-ng directive that replaces them. Tooltip, popover, and dismiss attributes have a quick fix that swaps in `bsTooltip`, `bsPopover`, `bsDialogClose`, `bsDrawerClose`, or `bsToastClose`.
- Warnings when a directive is on an element its selector does not match, such as `bsButton` on a `div` or `bsCheck` on a radio input, which Angular silently ignores.
- A quick fix that adds a directive used in a template to the `bootstrap-ng` import and the component `imports` array.
- Warnings in the Problems panel when a standalone component template uses a `bs*` directive that is not imported, with the import quick fix attached. Add `"source.fixAll.bootstrap-ng": "explicit"` to `editor.codeActionsOnSave` to add missing imports to inline templates on save.
- **Bootstrap-ng: Open Documentation** opens the docs for the symbol under the cursor, or a list of components.

## Settings

- `bootstrap-ng.validateAttributeValues` warns about unknown static values. Default: `true`.
- `bootstrap-ng.hintBootstrap5DataApi` hints about Bootstrap 5 data attributes. Default: `true`.
- `bootstrap-ng.validateHostElements` warns when a directive is on an element its selector does not match, such as `bsButton` on a `div` or `bsCheck` on a radio input, so Angular ignores it. Default: `true`.
- `bootstrap-ng.validateImports` warns when a directive is used in a standalone component template but not imported. Default: `true`.
