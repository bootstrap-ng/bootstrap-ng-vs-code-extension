# Changelog

## Unreleased

- A `source.fixAll.bootstrap-ng` code action, so `editor.codeActionsOnSave` can add missing imports for inline templates on save.
- Completions and hovers for Bootstrap 6 CSS classes in Angular class bindings: string literals in `[class]` and `[ngClass]` (including object keys and arrays), and the class name in `[class.name]`.
- Fix `package.json` warnings disappearing from the Problems panel a few minutes after startup. Closing a `package.json` now re-checks the saved file instead of clearing its warnings.
- Fix diagnostics and completions slowing down on large templates. Each keystroke in a 3,000-line template took about 0.4 seconds or more, and now takes a few milliseconds.
- Fix the Bootstrap 5 `data-bs-toggle` hints for `collapse`, `dropdown` and `offcanvas`, which named `bsCollapse`, `bsMenu` and `bsDrawer` instead of the `bsCollapseToggle`, `bsMenuToggle` and `bsDrawerToggle` trigger directives.
- Fix the extension hanging on an HTML template that starts with a tag such as `<styled-box>` or `<scripts>`.
- Fix the extension failing to activate with "Cannot find module './impl/format'" since 0.9.1.
- Quick fix for invalid attribute values that suggests the closest documented value, such as `theme="primray"` to `theme="primary"`.
- Quick fix that replaces Bootstrap 5 `data-bs-dismiss="modal"`, `"offcanvas"`, and `"toast"` with `bsDialogClose`, `bsDrawerClose`, and `bsToastClose`, and `data-bs-toggle="tooltip"` or `"popover"` with `bsTooltip` or `bsPopover`, carrying over `title`, `data-bs-title`, `data-bs-content`, `data-bs-placement`, and `data-bs-trigger`.
- Warnings in the Problems panel when a standalone component template uses a `bs*` directive that is not imported, with the import quick fix attached. Turn them off with `bootstrap-ng.validateImports`.

## 0.9.1

- Clear Problems-panel diagnostics when `package.json` is closed.
- Component snippets are no longer offered everywhere in TypeScript files. In TypeScript they appear only inside inline Angular `template` strings.
- CSS class completions and hovers now use the Bootstrap `6.0.0-alpha.2` stylesheet, adding classes such as `bg-opacity-*`, `fg-opacity-*`, `combobox`, `dialog-2xl` and `font-tabular-nums`, and dropping ones alpha.2 removed such as `bg-10` and `chip-input`.
- Harden `@Component` template discovery against comments, quoted metadata keys, and nested `template` properties.
- Parse commented and trailing-comma `package.json` files when checking bootstrap dependency versions.
- Scope TypeScript diagnostics, completions, hovers, and import quick fixes to inline `@Component` templates instead of every backtick literal.
- The directive catalog and class data load on first use instead of at activation.
- The extension no longer activates in every Node.js project. It activates for HTML, JSON and TypeScript files, and in workspaces with an `angular.json`.

## 0.9.0

- Warnings in the Problems panel when `package.json` depends on `bootstrap` or `bootstrap-ng` `6.0.0-alpha.1`, with a quick fix that updates the version to `6.0.0-alpha.2`.
- Completions for `bs*` directives, their inputs and outputs, and documented values such as `theme` and `bsButton="outline"`, in HTML templates and inline Angular `template` strings.
- Completions and hovers for Bootstrap 6 CSS classes in `class` attributes, including responsive variants such as `sm:d-flex` and `md:col-6`.
- Completions for `bootstrap-ng` imports.
- Hovers with a short description and a link to the docs.
- Snippets for common components and form controls (`bs-alert`, `bs-dialog`, `bs-form-field`, and others).
- Warnings when a static attribute value is outside the documented set.
- Information hints for Bootstrap 5 `data-bs-toggle` and `data-bs-dismiss` attributes, naming the bootstrap-ng directive that replaces them.
- A quick fix that adds a directive used in a template to the `bootstrap-ng` import and the component `imports` array.
- **Bootstrap-ng: Open Documentation** opens the docs for the symbol under the cursor, or a list of components.
- Commands, settings, diagnostics, hovers, and the import quick fix follow the VS Code display language for English and Japanese.
