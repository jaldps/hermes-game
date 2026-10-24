# Kanban — AAA Clearplay Arcade

Board: `game` (Hermes Kanban, SQLite-backed).
Project: `hermes-game` (primary repo: `C:/Users/Edgli/hermes-game`).
Profiles (bots):
- `game-maker` — builds/implements.
- `game-auditor` — harsh visual/AAA critic.
- `default` — orchestrator.

## Cards

Build (game-maker):
- t_fcd75c7b — Build AAA: Sinkhole City (hole)
- t_d92cae61 — Build AAA: Murmur flock
- t_1aed6a6f — Build AAA: Frostline Dash (sled/downhill)
- t_eb0f8af0 — Build AAA: Mob Rush crowds
- t_4a0ddc7b — Build AAA: Ridgeline
- t_656e7279 — Build AAA: Bowbrawl

Audit (game-auditor, depends on corresponding build):
- t_aa93ab89 — Audit AAA: Sinkhole City
- t_75a0c7e0 — Audit AAA: Murmur
- t_1bcb8374 — Audit AAA: Frostline Dash
- t_098d7fe2 — Audit AAA: Mob Rush
- t_f9dc77c4 — Audit AAA: Ridgeline
- t_62888de9 — Audit AAA: Bowbrawl

Final:
- t_09b2ecbd — Build final AAA APK (all six games) (depends on all audits)

## Commands

Switch to the game board:
```
hermes kanban boards switch game
```

List cards:
```
hermes kanban list
hermes kanban list --assignee game-maker
hermes kanban list --assignee game-auditor
```

Show a card:
```
hermes kanban show <task_id>
```

Dispatch one pass (spawn workers):
```
hermes kanban dispatch
```

Watch a card's event stream:
```
hermes kanban watch <task_id>
```

Tail worker log:
```
hermes kanban log <task_id>
```

Request review (builder -> auditor):
```
hermes kanban request-review <build_task_id>
```

Auditor verdict (request changes):
```
hermes kanban request-changes <review_task_id> --reason "..."
```

Complete a card:
```
hermes kanban complete <task_id>
```

Stats:
```
hermes kanban stats
```

## AAA bar

Each game must be compared blind (side-by-side) against a named AAA title for its genre. Builder implements; auditor is a harsh critic and blocks until ours wins. Loop max 3 rounds per card, then accept best and move on. Final APK built via `tools/apk.sh` shipping `web/`.
