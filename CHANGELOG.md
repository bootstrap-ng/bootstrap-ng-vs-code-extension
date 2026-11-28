# Changelog

## Unreleased

- Warn about undocumented values in string literals bound to an input, such as `[theme]="'primray'"`, with the same closest-match quick fix as static values.
- Warn when a directive is on an element its selector does not match, so Angular ignores it, such as `bsButton` on a `div` or `bsAccordionItem` on anything but `details`. The warning names the selector. Turn it off with `bootstrap-ng.validateHostElements`.
- Fix directives whose selector needs an attribute value, such as `input[type=checkbox][bsCheck]`, being treated as applied to any input. `<input type="radio" bsCheck>` no longer gets BsCheck hovers, completions or a missing-import warning, and gets the new warning instead.

## 0.9.4 (2026-11-28)

- Fix false missing-import warnings, and a quick fix that added duplicate names, when a comment sits in an `import { ... }` list or an `imports` array, such as `BsAlert, // alerts` followed by `BsTooltip`.
- Fix everything after a `<textarea>` being ignored when the textarea's text contains `<script`, `<style` or another `<textarea`.
- Fix `<textarea>` elements being ignored, so directives such as `<textarea bsFormControl>` got no completions, hovers, attribute-value warnings or missing-import warnings. The text inside a textarea is still skipped.
- Fix the import quick fix adding an `imports` array to a component marked `standalone: false`, which Angular rejects.
- Fix input completions ending their detail with a stray `=` when the input has no default value.
- Added French, German, Spanish and Italian translations.
- File size optimizations.

## 0.9.3 (2026-11-27)

- Fix false missing-import warnings for directives imported from a relative path or a barrel file, such as `import { BsDatepicker } from './datepicker'`, when they are listed in the component's `imports` array.

## 0.9.2 (2026-11-26)

- Fix `@Component` text inside an inline template being treated as a second component, which duplicated missing-import warnings and spurious attribute-value checks.
- Fix host-specific directive detection on dotted custom elements such as `<motion.div bsRange>`, including parser support for `.` in tag names and host matching on the segment after the last dot.
- Fix enum attribute-value warnings for documented values written with different casing, such as `theme="Primary"`.
- Fix missing-import warnings on `templateUrl` templates for components that omit a standalone `imports` array, which usually means the component is declared in an NgModule.
- Fix the import quick fix adding a second `bootstrap-ng` import when the file already imports from a subpath such as `bootstrap-ng/button`.
- Fix HTML comment skip ranges ending before the closing `-->`, and escaped quotes ending a quoted attribute value too early.
- Fix false missing-import warnings when a component lists `BOOTSTRAP_NG`, uses a constant such as `imports: SHARED` or a spread such as `[...SHARED]`, or renames an import with `import { BsAlert as Alert }`. The import quick fix no longer adds a second `imports` property, and adds the renamed name to the `imports` array.
- Fix hovers and the "Open bootstrap-ng documentation" command on a name in a `bootstrap-ng` import, which only worked with the cursor at the end of the name.
- Fix the import quick fix and fix-all on save writing broken code. In files without semicolons the new `bootstrap-ng` import landed inside the class body, and multiline `imports` arrays or import lists without a trailing comma lost the comma before the added name.
- Inline templates written as single- or double-quoted strings, such as `template: '<div bsAlert></div>'`, now get the same warnings, completions, hovers and import fixes as template literals. Completions there stay on one line and escape the string's quote.

## 0.9.1 (2026-11-25)

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
- Clear Problems-panel diagnostics when `package.json` is closed.
- Component snippets are no longer offered everywhere in TypeScript files. In TypeScript they appear only inside inline Angular `template` strings.
- CSS class completions and hovers now use the Bootstrap `6.0.0-alpha.2` stylesheet, adding classes such as `bg-opacity-*`, `fg-opacity-*`, `combobox`, `dialog-2xl` and `font-tabular-nums`, and dropping ones alpha.2 removed such as `bg-10` and `chip-input`.
- Harden `@Component` template discovery against comments, quoted metadata keys, and nested `template` properties.
- Parse commented and trailing-comma `package.json` files when checking bootstrap dependency versions.
- Scope TypeScript diagnostics, completions, hovers, and import quick fixes to inline `@Component` templates instead of every backtick literal.
- The directive catalog and class data load on first use instead of at activation.
- The extension no longer activates in every Node.js project. It activates for HTML, JSON and TypeScript files, and in workspaces with an `angular.json`.

## 0.9.0 (2026-11-24)

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
