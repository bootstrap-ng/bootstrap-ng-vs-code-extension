# AGENTS.md

<!-- https://agents.md -->

## GitHub Actions

- All GitHub Actions should be pinned versions to avoid breaking changes (SHA-1).
- If using actions/checkout, it should have `persist-credentials: false` set.
- Must be formatted with Prettier.

## Dependabot

- GitHub Actions updates should be grouped and updated monthly.
- npm packages should be grouped and updated monthly.
- Dependabot config should be formatted with Prettier.
- Dependencies should have a cooldown period of 7 days.
