# Fork Changes — JACKSON-FORK

All custom additions for Jackson's personal Hermes Studio dashboard.

## Upstream files modified
- `packages/client/src/App.vue` — added dual-pane layout mode (search `// JACKSON-FORK`)
- `packages/client/src/components/hermes/chat/ChatInput.vue` — added MacroBar import (search `// JACKSON-FORK`)
- `packages/client/src/components/layout/AppSidebar.vue` — added ProfileTabBar import (search `// JACKSON-FORK`)

## Additive files (safe to delete on upstream sync)
- `packages/client/src/components/custom/` — all custom components
- `packages/client/src/stores/custom/` — all custom stores

## Features added
1. **Dual-pane layout** — second-monitor mode with status panel left, chat right
2. **Status panel** — open loops, pending review count, cron status, active profile
3. **Macro buttons** — brain dump, /review, Sunday summary in chat input
4. **Profile tab switcher** — quick-switch between Hermes profiles from sidebar

## Merge strategy
- Run `git fetch upstream && git rebase upstream/main` weekly
- After rebase, grep for `// JACKSON-FORK` to verify patches survived
- All other changes are in custom/ directories — no upstream conflicts expected
- Track every upstream file touched in this file