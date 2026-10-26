# Care Reminder

A simple medication and care reminder that installs on a phone as a web app (PWA).
Plain HTML, CSS and JavaScript, no build step. All data stays on the device.

## How work flows

This repo follows [BEST-OF-AI-DEV](https://github.com/mogesjohnson/BEST-OF-AI-DEV):

- Every change starts from an issue with acceptance criteria.
- One issue, one branch: `<agent>/<issue>-<topic>` off fresh `main`.
- Conventional Commits (`feat(scope): subject`, at most 72 characters) with `Refs: #N`
  and `Agent: <name>` trailers. No closing keywords; issues close on owner acceptance.
- PRs stay under 600 changed lines. The PR body has Summary (with `Tracking:`), Validation
  (`pass|fail|blocked|not_run: <command>`), Size, Review checklist, and Risks and follow-ups.
- No force-push or history rewrites. Merge only on green checks. The owner allows
  self-merge in this repo.
- Hooks: run `npm install` once per clone. Tests: `npm test`.
