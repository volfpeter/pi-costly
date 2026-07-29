# pi-costly

Pi extension for exporting and forecasting cost and usage.

Reports are self-contained HTML files with interactive charts.

The extension has **no dependencies**. Exported HTML files use **Chart.js** from a CDN.

## Install

You can install the extension directly from GitHub:

```bash
pi install git:github.com/volfpeter/pi-costly
# or
pi install https://github.com/volfpeter/pi-costly
```

If you want to use it temporarily without installing, you can start Pi with the following arguments:

```bash
pi -e git:github.com/volfpeter/pi-costly
# or
pi -e https://github.com/volfpeter/pi-costly
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

Costs and other metrics come from the per-request usage data Pi already stores. The report fits a **quadratic trend curve** to the session so far and projects how per-request and cumulative costs are likely to grow if the session continues. Seeing the expected cost trajectory early helps you decide whether to continue the current session or hand off the remaining work to a new one before cost starts to run away.

For an example report, see [https://volfpeter.github.io/pi-costly](https://volfpeter.github.io/pi-costly).
