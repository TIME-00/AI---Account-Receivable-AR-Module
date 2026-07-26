## Browser validation

The shared deterministic browser suite is Playwright under `frontend/`.

Run from `frontend/`:

- `npm.cmd run test:e2e`
- `npm.cmd run test:e2e:headed`
- `npm.cmd run test:e2e:ui`
- `npm.cmd run test:e2e:debug`
- `npm.cmd run test:e2e:report`

Authentication state is stored locally under:

- `playwright/.auth/demo-finance.prod.json`
- `playwright/.auth/demo-finance.local.json`

Never read, print, copy, modify, expose or commit files under `playwright/.auth/`.
Never hard-code credentials in source, tests, prompts, logs or Git.
Production E2E is read-only unless the user explicitly authorizes narrowly scoped synthetic mutation.
Mutation tests must use unique synthetic identifiers, run serially and prove exact cleanup.
Retain screenshots, video and trace for failures.

Claude Code may additionally use the official Chrome integration for exploratory testing.
Repeatable regression evidence must use the repository Playwright suite.
