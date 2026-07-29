# pi-costly

Pi extension for exporting and forecasting cost and usage.

Reports are self-contained HTML files with interactive charts.

The extension has **no dependencies**. Exported HTML files use **Chart.js** from a CDN.

## Install

```bash
pi install /absolute/path/to/pi-costly
# or one-shot without install:
pi -e ./extensions/costly.ts
```

## Usage

Commands:

- `/costly [path]`: export report for current session to `path` or `{sessionId}.costly.html` in the current working directory if no path is provided
- `/costly-ls [path]`: list all sessions and pick the one to export, exported to `path` or `{sessionId}.costly.html` in the current working directory if no path is provided

## What you get

A self-contained HTML report for a session:

- **Summary**: session description and overview, including total cost, requests, tokens, cache use, tool calls
- **Cost chart**: per-request and cumulative cost, plus a projected trend for how costs are expected to grow as the session continues
- **Tokens chart**: input, output, and cached tokens per request, so you can catch cache misses easily
- **Tool calls chart**: tools invoked per request
- **Request table**: per-request cost and usage breakdown

Cost figures use the model's known pricing (including cache reads/writes when available). The trend estimates future cost from how context has been growing so far. It is useful for cost management and "continue or handoff" decisions.

For an example report, see [https://volfpeter.github.io/pi-costly](https://volfpeter.github.io/pi-costly).
