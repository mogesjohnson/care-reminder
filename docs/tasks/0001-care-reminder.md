# 0001: Care Reminder PWA, first version

Status: in progress
Owner: Moges Johnson
Agent: grok-bot
Refs: none (issues are opened per PR)

## Problem

Moges wants one simple place on his phone (Samsung Galaxy S23 Ultra, Chrome) for current
medications, the full medication and supplement list, today's doses and upcoming appointments.
It has to work offline, cost nothing to host, and keep the data on the phone.

## Outcome

A static PWA on GitHub Pages that installs with Chrome's "Add to Home Screen". It opens to a
local PIN lock, then shows five tabs: Today (daily doses), Current, Schedule, All meds and
Settings (backup, storage status, lock, reset). Everything is stored on the device.

## Acceptance criteria

- [ ] PIN is stored as a salted SHA-256 hash (Web Crypto), never in plain text. UI and README say it is a local lock, not real security.
- [ ] Reset wipes all data after a confirm.
- [ ] Current, All meds, Schedule and Today each support add, edit and delete.
- [ ] Schedule sorts earliest first; past visits are hidden unless "Show past" is on, then greyed.
- [ ] Today's check-offs are keyed by date, so a new day starts unchecked.
- [ ] `navigator.storage.persist()` is requested and its result is shown.
- [ ] JSON export and import round-trip the data.
- [ ] Manifest, 192/512/maskable PNG icons and a service worker; the app loads offline.
- [ ] `npm test` passes, including Node tests for sorting and daily reset.
- [ ] Headless Chrome check at 412x915 covers login, CRUD, reset logic, export/import and the service worker; screenshots taken with example data only.
- [ ] README links the live Pages URL, which returns HTTP 200.

## Scope

In: the app files at the repo root, `icons/`, `tests/`, README.

Out: accounts, servers, sync, push notifications, real health data.

## Constraints

No build step, no frameworks, no CDNs, no runtime dependencies. Mobile first, tap targets at
least 44px, white and mint green with a darker green accent.

## Plan

1. PWA shell: page, styles, manifest, icons, service worker.
2. Local PIN lock, storage layer and reset.
3. Medications: Current and All meds tabs.
4. Schedule tab with sorting tests.
5. Today tab with date-keyed check-offs and tests.
6. Settings: backup export/import and persistent storage status.
7. Headless browser check, screenshots and README.

## Open questions

None.
