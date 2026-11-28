# Contributing to Bootstrap-ng for VS Code

Thanks for helping improve the Bootstrap-ng extension. This guide covers how to set up the project, make a change and open a pull request.

## Reporting bugs and requesting features

- Search the [existing issues](https://github.com/bootstrap-ng/bootstrap-ng-vs-code-extension/issues) before opening a new one.
- For a bug, include the extension version, VS Code version, operating system and a small template or component that shows the problem.
- Please do not report security vulnerabilities in public issues. Follow the [security policy](.github/SECURITY.md) instead.

## Getting started

You need [Node.js](https://nodejs.org/) at the version in [`.nvmrc`](.nvmrc) (the same version is pinned for [Volta](https://volta.sh/) in `package.json`) and VS Code at the version in `engines.vscode` or newer.

```sh
git clone https://github.com/bootstrap-ng/bootstrap-ng-vs-code-extension.git
cd bootstrap-ng-vs-code-extension
nvm use
npm ci
npm run compile
```

The extension is bundled with esbuild from `src/extension.js` to `out/extension.js`. Use `npm run watch` to rebuild on every save. To try your changes, open the folder in VS Code and run **Debug: Start Debugging** (<kbd>F5</kbd>) and pick **VS Code Extension Development** if asked, then open an Angular project in the new window.

## Project layout

| Path                          | Contents                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/`                        | Extension source, written in vanilla JavaScript (CommonJS).                                                |
| `src/data/`                   | Generated `catalog.json` (directives, inputs and docs) and `classes.json` (Bootstrap CSS classes).         |
| `scripts/`                    | Scripts that regenerate `src/data/` from the bootstrap-ng docs and the Bootstrap CSS.                      |
| `snippets/`                   | HTML snippets contributed by the extension.                                                                |
| `l10n/`, `package.nls.*.json` | Translations of runtime strings and of the manifest (commands, settings and description).                  |
| `test/`                       | Unit tests run with the Node.js test runner. `test/vscode/` holds the smoke test that runs inside VS Code. |

## Scripts

| Command               | What it does                                                                       |
| --------------------- | ---------------------------------------------------------------------------------- |
| `npm run compile`     | Bundles the extension into `out/extension.js`.                                     |
| `npm run watch`       | Same as `compile`, rebuilding on every change.                                     |
| `npm test`            | Compiles, checks the bundle parses and runs the unit tests in `test/**/*.test.js`. |
| `npm run test:vscode` | Compiles and runs the smoke test in a downloaded copy of VS Code.                  |
| `npm run lint`        | Formats with Prettier, then runs Stylelint and ESLint.                             |
| `npm run lint:fix`    | Same as `lint`, fixing what Stylelint and ESLint can.                              |
| `npm run spellcheck`  | Runs cspell over HTML, JavaScript, JSON, Markdown and YAML files.                  |
| `npm run package`     | Builds a minified bundle and packages a `.vsix` with `vsce`.                       |
| `npm run all`         | Runs `lint`, `test`, `compile` and `package` in order.                             |

On Linux without a display, run the smoke test with `xvfb-run -a npm run test:vscode`, as CI does.

### Regenerating data

`src/data/catalog.json` and `src/data/classes.json` are generated, so don't edit them by hand. Run the scripts instead:

```sh
node scripts/generate-catalog.js   # from the bootstrap-ng docs
node scripts/generate-classes.js   # from the Bootstrap CSS on jsDelivr
```

Each script also accepts local file paths in place of the default URLs.

## Making a change

- Keep to vanilla JavaScript, with no new runtime dependencies unless they are really needed.
- Format everything with Prettier (`npm run prettier`). The [`.editorconfig`](.editorconfig) sets 2-space indents, LF line endings and a final newline.
- Keep rules, attributes and lists in alphabetical order.
- Never downgrade dependencies. Dependabot opens grouped npm and GitHub Actions updates monthly.
- Add or update tests in `test/` for any behavior you change.
- User-facing text must be translatable. Wrap runtime strings with the helper in `src/l10n.js` and add the translation to each `l10n/bundle.l10n.*.json` file. Manifest strings go in `package.nls.json` and each `package.nls.*.json` file. If you can't translate a string, leave the English text and mention it in the pull request.
- If cspell flags a real word, add it to the `words` list in [`.cspell.json`](.cspell.json), keeping the list sorted.

### GitHub Actions

- Pin every action to a full commit SHA, with the version in a trailing comment.
- Set `persist-credentials: false` on every `actions/checkout` step.
- Format workflow files with Prettier.

## Changelog

Add a line for each user-facing change to [`CHANGELOG.md`](CHANGELOG.md), under the newest version at the top of the file. Write it from the user's point of view in full sentences, for example "Fix false missing-import warnings when…" or "Quick fix that…". Maintainers add the version heading and date when they release.

## Before you open a pull request

Run these and make sure they pass:

```sh
npm run lint
npm test
npm run compile
```

## Pull requests

- Use a meaningful branch name, such as `fix/textarea-directives` or `feat/class-completions`. Avoid random or auto-generated names.
- Keep each pull request to a single commit. When you push follow-up changes for review or CI fixes, fold them into that commit and push with `git push --force-with-lease` rather than adding new commits.
- Describe what changed and why, and link any related issue.

Every pull request runs these checks:

- **Tests**: `npm test` on Node.js from `.nvmrc`, and the VS Code smoke test.
- **Super Linter**: lints the changed files.
- **Check spelling**: cspell on the changed files.
- **CodeQL**: static analysis of the JavaScript.
- **PR Review**: an automated review that comments on the diff and may approve clean pull requests.

Pull requests are reviewed by the [code owners](.github/CODEOWNERS). Once a maintainer approves a pull request from a branch in this repository, it is squash-merged automatically when the checks pass. Pull requests from forks are merged by hand.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
