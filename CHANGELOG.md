# Changelog

## Unreleased

- The extension no longer activates in every Node.js project. It activates for HTML, JSON and TypeScript files, and in workspaces with an `angular.json`.
- The directive catalog and class data load on first use instead of at activation.
- Component snippets are no longer offered everywhere in TypeScript files. In TypeScript they appear only inside inline Angular `template` strings.

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
