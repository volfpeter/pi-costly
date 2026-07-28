# pi-costly

Pi extension that exports an HTML cost/usage report for a session branch.

Reads usage pi already stores. Writes a self-contained HTML file with charts.

## Install

```bash
pi install /absolute/path/to/pi-costly
# or one-shot without install:
pi -e ./extensions/costly.ts
```

## Usage

```text
/costly                 # current branch → ./{sessionId}.costly.html
/costly ./out.html      # current branch → custom path
/costly-ls              # pick any session (all projects) → report in cwd
```

Default output path: `./{sessionId}.costly.html` (cwd where pi is running).

`/costly-ls` lists sessions via `SessionManager.listAll()` (all projects). Order: proximity to current cwd (this tree first, then parents up to `/`); within a bucket: path, then newer first, then id. Scrollable picker (~10 rows). Selecting one opens that session file **read-only** — it does not switch your active chat.

## What you get

Header summary:

- First user prompt (session description) + session id/name/file
- Total cost, request count, tokens (input/output)
- Cache read + cache-read ratio, cache write, tool call count

Charts (Chart.js CDN):

1. **Cost** — per-request bars + cumulative line + quadratic trend (growing-context ~N² model, with R²)
2. **Tokens** — stacked input / cache read / cache write / output
3. **Tool calls** — count per request

Plus a per-request detail table.

## How it works

Uses `getBranch()` — entries from root to the current leaf of the chosen session. That is the conversation as it counts right now (follows `/tree`, `/fork`, `/clone` on that file).

Each assistant message already carries:

```ts
usage: {
  input, output, cacheRead, cacheWrite, totalTokens,
  cost: { input, output, cacheRead, cacheWrite, total }
}
```

No live logging. No CSV. No parallel database.

## Notes

- `usage.cost.total` is **per request**. Cumulative cost is a running sum.
- Error/aborted assistant messages are skipped only when usage is all zeros (failed calls that still billed are included).
- Does **not** replace `/session` (TUI text totals) or `/export` (chat transcript).
- Charts need network for Chart.js CDN (offline/vendored later if needed).
- `/costly-ls` needs the interactive TUI (`ctx.ui.custom` + `SelectList`).

## Layout

```text
pi-costly/
  package.json
  README.md
  dev/DESIGN.md
  extensions/
    costly.ts         # /costly + /costly-ls
    collect.ts        # branch → rows + summary
    report.ts         # rows → HTML
    fit.ts            # quadratic OLS trend
    sort-sessions.ts  # proximity sort for /costly-ls
```
