import type { CostlyRow, CostlySummary } from "./collect.ts";
import { fitQuadratic } from "./fit.ts";

export type ReportMeta = {
	sessionId: string;
	sessionFile?: string;
	/** User-defined session name, if any. */
	sessionName?: string;
	/** First user prompt — pi uses this as the session description. */
	description?: string;
	generatedAt: string;
	title?: string;
};

function esc(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escMultiline(s: string): string {
	return esc(s).replace(/\r\n|\r|\n/g, "<br/>");
}

function oneLine(s: string, max: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	return `${t.slice(0, max - 1)}…`;
}

function fmtCost(n: number): string {
	if (n >= 1) return `$${n.toFixed(2)}`;
	if (n >= 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(6)}`;
}

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function pct(n: number): string {
	return `${(n * 100).toFixed(1)}%`;
}

/**
 * Build a self-contained HTML cost/usage report with Chart.js CDN charts.
 */
export function buildHtml(
	rows: CostlyRow[],
	summary: CostlySummary,
	meta: ReportMeta,
): string {
	/** Extra request indices to project the quadratic trend forward. */
	const TREND_HORIZON = 8;

	const n = rows.length;
	const histLabels = rows.map((r) => r.index);
	const costPerRequestHist = rows.map((r) => r.costTotal);
	const cumulativeCostHist: number[] = [];
	let running = 0;
	for (const r of rows) {
		running += r.costTotal;
		cumulativeCostHist.push(running);
	}

	const inputTokensHist = rows.map((r) => r.input);
	const outputTokensHist = rows.map((r) => r.output);
	const cacheReadTokensHist = rows.map((r) => r.cacheRead);
	const cacheWriteTokensHist = rows.map((r) => r.cacheWrite);
	const toolCallsHist = rows.map((r) => r.toolCalls);

	// Quadratic trend on cumulative cost vs request index (growing-context model).
	const quadFit = fitQuadratic(histLabels, cumulativeCostHist);
	const trendR2 = quadFit?.r2 ?? null;
	const extend = quadFit && n >= 4 ? TREND_HORIZON : 0;

	const labels: number[] = [];
	for (let i = 1; i <= n + extend; i++) labels.push(i);

	const nullPad: null[] = Array.from({ length: extend }, () => null);
	const costPerRequest = [...costPerRequestHist, ...nullPad];
	const cumulativeCost = [...cumulativeCostHist, ...nullPad];

	// One continuous quadratic series (history + optional +horizon projection).
	// Per-request forecast bars = successive differences on the projected tail.
	let cumulativeTrend: number[] | null = null;
	let costPerRequestForecast: (number | null)[] | null = null;
	let forecastAtHorizon: number | null = null;
	if (quadFit) {
		const yAt = (x: number) => quadFit.a + quadFit.b * x + quadFit.c * x * x;
		cumulativeTrend = labels.map((x) => yAt(x));
		if (extend > 0) {
			costPerRequestForecast = labels.map((x) => {
				if (x <= n) return null;
				// Δcumul at step x ≈ implied per-request cost under the fit
				return yAt(x) - yAt(x - 1);
			});
			forecastAtHorizon = yAt(n + extend);
		}
	}

	const chartData = {
		/** X labels for cost chart (includes +horizon projection indices). */
		labels,
		/** X labels for token/tool charts (observed only). */
		histLabels,
		/** Last observed request index (projection starts after this). */
		histCount: n,
		costPerRequest,
		costPerRequestForecast,
		cumulativeCost,
		cumulativeTrend,
		trendR2,
		trendHorizon: extend,
		forecastAtHorizon,
		inputTokens: inputTokensHist,
		outputTokens: outputTokensHist,
		cacheReadTokens: cacheReadTokensHist,
		cacheWriteTokens: cacheWriteTokensHist,
		toolCalls: toolCallsHist,
	};

	const trendNote = (() => {
		const parts = [
			`<span class="swatch swatch-bar-obs"></span> orange bars — observed cost / request`,
			`<span class="swatch swatch-cumul"></span> green line — observed cumulative cost`,
		];
		if (quadFit) {
			parts.push(
				`<span class="swatch swatch-trend"></span> blue line — quadratic fit to cumulative` +
					(extend > 0
						? ` (solid on history, dashed +${extend} projection)`
						: "") +
					` · R^2 ${quadFit.r2.toFixed(3)}`,
			);
			if (extend > 0) {
				parts.push(
					`<span class="swatch swatch-bar-proj"></span> faint amber bars — projected cost / request` +
						(forecastAtHorizon != null
							? ` · ~${fmtCost(forecastAtHorizon)} total @ req ${n + extend}`
							: ""),
				);
			}
		} else if (rows.length > 0 && rows.length < 4) {
			parts.push(`trend fit needs at least 4 requests`);
		}
		return `<div class="chart-note">${parts.join("<br/>")}</div>`;
	})();

	const trendExplainer = rows.length === 0
		? ""
		: `<div class="chart-explainer">
  <strong>How cost tends to grow.</strong>
  Each request re-sends the conversation so far. As the session gets longer, that context
  usually grows, so <em>per-request</em> cost often creeps up — not just because of the new
  reply, but because the model is billed again for (mostly cached) history. At high cache-hit
  rates, cache reads dominate that bill.
  <br/><br/>
  If per-request cost stayed flat, <em>total</em> cost would rise <strong>linearly</strong> with
  request count (a straight line). If context keeps growing turn after turn, per-request cost
  rises roughly with session length, and total cost curves up <strong>quadratically</strong>
  (~N&sup2; in request count) — long agent runs get expensive faster than “N times the first turn.”
  <br/><br/>
  The blue line is one quadratic curve fitted to this branch’s cumulative cost
  ${quadFit ? `(R^2 = ${quadFit.r2.toFixed(3)}; closer to 1 means the curve matches well)` : "(shown when there are enough requests)"},
  drawn through the observed range and extended <strong>${TREND_HORIZON} requests ahead</strong>
  (dashed) so you can ballpark where total spend is heading if growth continues
  ${forecastAtHorizon != null ? `(about ${fmtCost(forecastAtHorizon)} by request ${n + TREND_HORIZON})` : ""}.
  Faint amber bars are the implied <em>per-request</em> cost on that projected tail
  (difference between successive points on the same curve) — not a separate model.
  Compaction, cache misses, fat outputs, or model switches bend the story — treat the fit as a
  guide to the shape, not a promise.
</div>`;

	const descOneLine = meta.description ? oneLine(meta.description, 72) : "";
	const title =
		meta.title ??
		(descOneLine
			? `Cost report — ${descOneLine}`
			: meta.sessionName
				? `Cost report — ${meta.sessionName}`
				: `Cost report — ${meta.sessionId}`);

	const descriptionBlock = meta.description
		? `<div class="description">${escMultiline(meta.description)}</div>`
		: "";

	const sessionNameLine = meta.sessionName
		? `<div class="meta-line">Name: <strong>${esc(meta.sessionName)}</strong></div>`
		: "";

	const sessionIdLine = `<div class="meta-line">Session id: <code>${esc(meta.sessionId)}</code></div>`;

	const sessionFileLine = meta.sessionFile
		? `<div class="meta-line">File: <code>${esc(meta.sessionFile)}</code></div>`
		: `<div class="meta-line">File: <em>ephemeral (no session file)</em></div>`;

	const modelsLine =
		summary.models.length > 0
			? `<div class="meta-line">Models: ${summary.models.map((m) => `<code>${esc(m)}</code>`).join(", ")}</div>`
			: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --border: #2a2e3a;
    --text: #e6e8ef;
    --muted: #8b90a0;
    --accent: #6c9eff;
    --cost: #f0a060;
    --cumul: #7dd3a0;
    --input: #6c9eff;
    --output: #c084fc;
    --cache-read: #34d399;
    --cache-write: #fbbf24;
    --tools: #f472b6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
    padding: 2rem 1.5rem 4rem;
  }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 0.5rem; }
  .description {
    font-size: 1.05rem;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    border-radius: 8px;
    padding: 0.85rem 1rem;
    margin: 0 0 1rem;
    white-space: normal;
    overflow-wrap: anywhere;
    max-height: 8.5em;
    overflow: auto;
  }
  .meta { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .meta-line { margin: 0.15rem 0; }
  .meta strong { color: var(--text); font-weight: 600; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.8em;
    background: var(--surface);
    padding: 0.1em 0.35em;
    border-radius: 4px;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.75rem;
    margin-bottom: 2rem;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.9rem 1rem;
  }
  .card .label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin-bottom: 0.25rem;
  }
  .card .value {
    font-size: 1.25rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .card .sub {
    font-size: 0.75rem;
    color: var(--muted);
    margin-top: 0.15rem;
  }
  .chart-block {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.25rem 1.25rem 0.75rem;
    margin-bottom: 1.25rem;
  }
  .chart-block h2 {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
    color: var(--text);
  }
  .chart-note {
    font-size: 0.75rem;
    color: var(--muted);
    margin: -0.25rem 0 0.75rem;
    line-height: 1.55;
  }
  .chart-note .swatch {
    display: inline-block;
    width: 0.85em;
    height: 0.85em;
    margin-right: 0.35em;
    vertical-align: -0.1em;
    border-radius: 2px;
  }
  .swatch-bar-obs { background: rgba(240, 160, 96, 0.75); border: 1px solid #f0a060; }
  .swatch-cumul {
    background: transparent;
    border: none;
    border-top: 3px solid #7dd3a0;
    height: 0;
    vertical-align: 0.25em;
    width: 1em;
  }
  .swatch-trend {
    background: transparent;
    border: none;
    border-top: 3px solid #5b8def;
    height: 0;
    vertical-align: 0.25em;
    width: 1em;
  }
  .swatch-bar-proj { background: rgba(245, 165, 36, 0.35); border: 1px solid rgba(245, 165, 36, 0.8); }
  .chart-wrap {
    position: relative;
    height: 280px;
  }
  .chart-explainer {
    font-size: 0.82rem;
    color: var(--muted);
    line-height: 1.55;
    margin: 0.85rem 0 0;
    padding: 0.85rem 1rem;
    background: rgba(0,0,0,0.2);
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  .chart-explainer strong { color: var(--text); font-weight: 600; }
  .chart-explainer em { color: var(--text); font-style: italic; }
  .empty {
    text-align: center;
    color: var(--muted);
    padding: 3rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  th, td {
    text-align: right;
    padding: 0.4rem 0.55rem;
    border-bottom: 1px solid var(--border);
  }
  th:first-child, td:first-child,
  th.left, td.left { text-align: left; }
  th {
    color: var(--muted);
    font-weight: 500;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    position: sticky;
    top: 0;
    background: var(--surface);
  }
  tr:hover td { background: rgba(255,255,255,0.03); }
  .table-scroll {
    max-height: 420px;
    overflow: auto;
  }
  footer {
    margin-top: 2rem;
    color: var(--muted);
    font-size: 0.75rem;
    text-align: center;
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>Cost report</h1>
  ${descriptionBlock}
  <div class="meta">
    ${sessionNameLine}
    ${sessionIdLine}
    ${sessionFileLine}
    ${modelsLine}
    <div class="meta-line">Generated: ${esc(meta.generatedAt)}</div>
  </div>

  ${
		rows.length === 0
			? `<div class="empty">No assistant requests with usage on this branch.</div>`
			: `
  <div class="cards">
    <div class="card">
      <div class="label">Total cost</div>
      <div class="value">${fmtCost(summary.totalCost)}</div>
    </div>
    <div class="card">
      <div class="label">Requests</div>
      <div class="value">${summary.requestCount}</div>
    </div>
    <div class="card">
      <div class="label">Total tokens</div>
      <div class="value">${fmtTokens(summary.totalTokens)}</div>
      <div class="sub">↑${fmtTokens(summary.totalInput)} ↓${fmtTokens(summary.totalOutput)}</div>
    </div>
    <div class="card">
      <div class="label">Cache read</div>
      <div class="value">${fmtTokens(summary.totalCacheRead)}</div>
      <div class="sub">ratio ${pct(summary.cacheReadRatio)}</div>
    </div>
    <div class="card">
      <div class="label">Cache write</div>
      <div class="value">${fmtTokens(summary.totalCacheWrite)}</div>
    </div>
    <div class="card">
      <div class="label">Tool calls</div>
      <div class="value">${summary.totalToolCalls}</div>
    </div>
  </div>

  <div class="chart-block">
    <h2>Cost per request &amp; cumulative</h2>
    ${trendNote}
    <div class="chart-wrap"><canvas id="costChart"></canvas></div>
    ${trendExplainer}
  </div>

  <div class="chart-block">
    <h2>Tokens per request</h2>
    <div class="chart-wrap"><canvas id="tokensChart"></canvas></div>
  </div>

  <div class="chart-block">
    <h2>Tool calls per request</h2>
    <div class="chart-wrap"><canvas id="toolsChart"></canvas></div>
  </div>

  <div class="chart-block">
    <h2>Per-request detail</h2>
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th class="left">Model</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache R</th>
            <th>Cache W</th>
            <th>Tools</th>
            <th>Cost</th>
            <th>Cumul.</th>
          </tr>
        </thead>
        <tbody>
          ${rows
						.map((r, i) => {
							const model = esc(`${r.provider}/${r.model}`);
							return `<tr>
            <td>${r.index}</td>
            <td class="left"><code>${model}</code></td>
            <td>${r.input.toLocaleString()}</td>
            <td>${r.output.toLocaleString()}</td>
            <td>${r.cacheRead.toLocaleString()}</td>
            <td>${r.cacheWrite.toLocaleString()}</td>
            <td>${r.toolCalls}</td>
            <td>${fmtCost(r.costTotal)}</td>
            <td>${fmtCost(cumulativeCostHist[i]!)}</td>
          </tr>`;
						})
						.join("\n")}
        </tbody>
      </table>
    </div>
  </div>
  `
	}

  <footer>pi-costly · per-request usage from session branch</footer>
</div>

<script id="costly-data" type="application/json">${JSON.stringify({ rows, summary, meta, chartData })}</script>
${
	rows.length === 0
		? ""
		: `
<script>
const data = JSON.parse(document.getElementById("costly-data").textContent);
const { labels, histLabels, histCount, costPerRequest, costPerRequestForecast, cumulativeCost, cumulativeTrend, trendR2, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, toolCalls } = data.chartData;

const gridColor = "rgba(255,255,255,0.06)";
const tickColor = "#8b90a0";

Chart.defaults.color = tickColor;
Chart.defaults.borderColor = gridColor;
Chart.defaults.font.family = 'ui-sans-serif, system-ui, sans-serif';

const commonOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: "index", intersect: false },
  plugins: {
    legend: { labels: { boxWidth: 12, padding: 16 } },
  },
  scales: {
    x: {
      title: { display: true, text: "Request #", color: tickColor },
      ticks: { color: tickColor, maxRotation: 0 },
      grid: { color: gridColor },
    },
    y: {
      beginAtZero: true,
      ticks: { color: tickColor },
      grid: { color: gridColor },
    },
  },
};

const costDatasets = [
  {
    type: "bar",
    label: "Cost / request (observed)",
    data: costPerRequest,
    backgroundColor: "rgba(240, 160, 96, 0.55)",
    borderColor: "#f0a060",
    borderWidth: 1,
    yAxisID: "y",
    order: 4,
  },
  {
    type: "line",
    label: "Cumulative cost (observed)",
    data: cumulativeCost,
    borderColor: "#7dd3a0",
    backgroundColor: "rgba(125, 211, 160, 0.1)",
    pointRadius: 2,
    tension: 0.15,
    yAxisID: "y1",
    order: 2,
  },
];

if (costPerRequestForecast) {
  costDatasets.push({
    type: "bar",
    label: "Cost / request (projected)",
    data: costPerRequestForecast,
    backgroundColor: "rgba(245, 165, 36, 0.22)",
    borderColor: "rgba(245, 165, 36, 0.7)",
    borderWidth: 1,
    borderSkipped: false,
    yAxisID: "y",
    order: 3,
  });
}

if (cumulativeTrend) {
  const r2label = typeof trendR2 === "number" ? (" (R^2 " + trendR2.toFixed(2) + ")") : "";
  const lastHist = typeof histCount === "number" ? histCount : labels.length;
  costDatasets.push({
    type: "line",
    label: "Quadratic cumulative trend" + r2label,
    data: cumulativeTrend,
    borderColor: "#5b8def",
    backgroundColor: "transparent",
    pointBackgroundColor: "#5b8def",
    pointBorderColor: "#cfe0ff",
    pointBorderWidth: 1,
    pointRadius: 3,
    pointHoverRadius: 5,
    showLine: true,
    tension: 0,
    yAxisID: "y1",
    order: 0,
    // Solid through observed requests; dashed on the projected tail
    segment: {
      borderDash: function(ctx) {
        // p1 is the end point of the segment (0-based index)
        return ctx.p1DataIndex >= lastHist ? [6, 4] : undefined;
      },
    },
  });
}

new Chart(document.getElementById("costChart"), {
  data: {
    labels,
    datasets: costDatasets,
  },
  options: {
    ...commonOptions,
    scales: {
      x: commonOptions.scales.x,
      y: {
        ...commonOptions.scales.y,
        position: "left",
        title: { display: true, text: "Cost / req ($)", color: "#f0a060" },
        ticks: {
          color: tickColor,
          callback: (v) => "$" + Number(v).toFixed(4),
        },
      },
      y1: {
        position: "right",
        beginAtZero: true,
        title: { display: true, text: "Cumulative ($)", color: "#7dd3a0" },
        grid: { drawOnChartArea: false },
        ticks: {
          color: tickColor,
          callback: (v) => "$" + Number(v).toFixed(3),
        },
      },
    },
  },
});

new Chart(document.getElementById("tokensChart"), {
  type: "bar",
  data: {
    labels: histLabels,
    datasets: [
      {
        label: "Input",
        data: inputTokens,
        backgroundColor: "rgba(108, 158, 255, 0.7)",
        stack: "t",
      },
      {
        label: "Cache read",
        data: cacheReadTokens,
        backgroundColor: "rgba(52, 211, 153, 0.7)",
        stack: "t",
      },
      {
        label: "Cache write",
        data: cacheWriteTokens,
        backgroundColor: "rgba(251, 191, 36, 0.7)",
        stack: "t",
      },
      {
        label: "Output",
        data: outputTokens,
        backgroundColor: "rgba(192, 132, 252, 0.7)",
        stack: "t",
      },
    ],
  },
  options: {
    ...commonOptions,
    scales: {
      x: { ...commonOptions.scales.x, stacked: true },
      y: {
        ...commonOptions.scales.y,
        stacked: true,
        title: { display: true, text: "Tokens", color: tickColor },
      },
    },
  },
});

new Chart(document.getElementById("toolsChart"), {
  type: "bar",
  data: {
    labels: histLabels,
    datasets: [
      {
        label: "Tool calls",
        data: toolCalls,
        backgroundColor: "rgba(244, 114, 182, 0.65)",
        borderColor: "#f472b6",
        borderWidth: 1,
      },
    ],
  },
  options: {
    ...commonOptions,
    scales: {
      x: commonOptions.scales.x,
      y: {
        ...commonOptions.scales.y,
        ticks: { ...commonOptions.scales.y.ticks, stepSize: 1 },
        title: { display: true, text: "Count", color: tickColor },
      },
    },
  },
});
</script>
`
}
</body>
</html>
`;
}
