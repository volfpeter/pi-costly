/**
 * pi-costly — export HTML cost/usage charts for a session branch.
 *
 * Usage:
 *   /costly              current branch → ./{sessionId}.costly.html
 *   /costly [path.html]  current branch → custom path
 *   /costly-ls           pick any session → report in cwd
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	SessionInfo,
} from "@earendil-works/pi-coding-agent";
import { DynamicBorder, SessionManager } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import {
	collectRows,
	firstUserPrompt,
	summarize,
	type CostlyRow,
	type CostlySummary,
} from "./collect.ts";
import { buildHtml } from "./report.ts";
import { sortSessionsByProximity } from "./sort-sessions.ts";

const LIST_MAX_VISIBLE = 10;

function resolveOutputPath(args: string, sessionId: string): string {
	const trimmed = args.trim();
	if (trimmed) {
		return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
	}
	return join(process.cwd(), `${sessionId}.costly.html`);
}

function fmtCost(n: number): string {
	return n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(6)}`;
}

function truncate(s: string, max: number): string {
	const oneLine = s.replace(/\s+/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, max - 1)}…`;
}

function sessionToItem(s: SessionInfo): SelectItem {
	const when = s.modified.toISOString().slice(0, 16).replace("T", " ");
	const shortId = s.id.slice(0, 8);
	const title = s.name
		? truncate(s.name, 48)
		: s.firstMessage
			? truncate(s.firstMessage, 48)
			: "(empty)";
	const cwd = s.cwd ? truncate(s.cwd, 56) : "(no cwd)";
	return {
		value: s.path,
		label: `${when}  ${String(s.messageCount).padStart(4)}msg  ${shortId}`,
		description: `${cwd}  ·  ${title}`,
	};
}

function writeReport(opts: {
	branch: SessionEntry[];
	sessionId: string;
	sessionFile?: string;
	sessionName?: string;
	/** Prefer explicit description (e.g. SessionInfo.firstMessage); else first user on branch. */
	description?: string;
	outPath: string;
}): { rows: CostlyRow[]; summary: CostlySummary; outPath: string } {
	const rows = collectRows(opts.branch);
	const summary = summarize(rows);
	const description =
		opts.description?.trim() || firstUserPrompt(opts.branch) || undefined;
	const html = buildHtml(rows, summary, {
		sessionId: opts.sessionId,
		sessionFile: opts.sessionFile,
		sessionName: opts.sessionName,
		description,
		generatedAt: new Date().toISOString(),
	});
	mkdirSync(dirname(opts.outPath), { recursive: true });
	writeFileSync(opts.outPath, html, "utf8");
	return { rows, summary, outPath: opts.outPath };
}

async function pickSession(
	ctx: ExtensionContext,
	sessions: SessionInfo[],
): Promise<SessionInfo | undefined> {
	const sorted = sortSessionsByProximity(sessions, ctx.cwd);
	const items = sorted.map(sessionToItem);
	const byPath = new Map(sorted.map((s) => [s.path, s]));

	const path = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
		container.addChild(
			new Text(
				theme.fg(
					"accent",
					theme.bold(`Select session (${sorted.length})`),
				),
			),
		);

		const selectList = new SelectList(items, Math.min(items.length, LIST_MAX_VISIBLE), {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		});

		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);
		container.addChild(
			new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")),
		);
		container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});

	if (!path) return undefined;
	return byPath.get(path);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("costly", {
		description: "Export cost/usage charts (HTML) for the current branch",
		handler: async (args, ctx) => {
			try {
				const sessionId = ctx.sessionManager.getSessionId();
				const result = writeReport({
					branch: ctx.sessionManager.getBranch(),
					sessionId,
					sessionFile: ctx.sessionManager.getSessionFile(),
					sessionName: ctx.sessionManager.getSessionName(),
					outPath: resolveOutputPath(args, sessionId),
				});
				ctx.ui.notify(
					`Wrote ${result.rows.length} request(s), ${fmtCost(result.summary.totalCost)} total → ${result.outPath}`,
					"info",
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`costly failed: ${msg}`, "error");
			}
		},
	});

	pi.registerCommand("costly-ls", {
		description: "Pick any session, then export cost/usage charts (HTML)",
		handler: async (_args, ctx) => {
			try {
				const sessions = await SessionManager.listAll();
				if (sessions.length === 0) {
					ctx.ui.notify("No sessions found", "info");
					return;
				}

				const selected = await pickSession(ctx, sessions);
				if (!selected) return;

				// Read-only open — does not switch the active chat session
				const sm = SessionManager.open(selected.path);
				const sessionId = sm.getSessionId();
				const result = writeReport({
					branch: sm.getBranch(),
					sessionId,
					sessionFile: sm.getSessionFile() ?? selected.path,
					sessionName: sm.getSessionName() ?? selected.name,
					description: selected.firstMessage || undefined,
					outPath: resolveOutputPath("", sessionId),
				});

				ctx.ui.notify(
					`Wrote ${result.rows.length} request(s), ${fmtCost(result.summary.totalCost)} total → ${result.outPath}`,
					"info",
				);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`costly-ls failed: ${msg}`, "error");
			}
		},
	});
}
