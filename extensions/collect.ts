import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export type CostlyRow = {
	index: number;
	timestamp?: number;
	provider: string;
	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	costInput: number;
	costOutput: number;
	costCacheRead: number;
	costCacheWrite: number;
	costTotal: number;
	toolCalls: number;
};

function isZeroUsage(msg: AssistantMessage): boolean {
	const u = msg.usage;
	return (
		u.input === 0 &&
		u.output === 0 &&
		u.cacheRead === 0 &&
		u.cacheWrite === 0 &&
		u.totalTokens === 0 &&
		u.cost.total === 0
	);
}

function countToolCalls(msg: AssistantMessage): number {
	return msg.content.filter((block) => block.type === "toolCall").length;
}

function userMessageText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((b): b is { type: "text"; text: string } =>
			!!b && typeof b === "object" && (b as { type?: string }).type === "text",
		)
		.map((b) => b.text)
		.join("")
		.trim();
}

/** First non-empty user prompt on the branch (pi session description source). */
export function firstUserPrompt(branch: SessionEntry[]): string | undefined {
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		if (entry.message.role !== "user") continue;
		const text = userMessageText(entry.message.content);
		if (text) return text;
	}
	return undefined;
}

/**
 * Collect per-request cost/usage rows from the current session branch.
 * Skips error/aborted assistant messages only when usage is all zeros.
 */
export function collectRows(branch: SessionEntry[]): CostlyRow[] {
	const rows: CostlyRow[] = [];

	for (const entry of branch) {
		if (entry.type !== "message") continue;
		if (entry.message.role !== "assistant") continue;

		const msg = entry.message as AssistantMessage;

		if (
			(msg.stopReason === "error" || msg.stopReason === "aborted") &&
			isZeroUsage(msg)
		) {
			continue;
		}

		const u = msg.usage;
		rows.push({
			index: rows.length + 1,
			timestamp: msg.timestamp,
			provider: msg.provider,
			model: msg.model,
			input: u.input,
			output: u.output,
			cacheRead: u.cacheRead,
			cacheWrite: u.cacheWrite,
			totalTokens: u.totalTokens,
			costInput: u.cost.input,
			costOutput: u.cost.output,
			costCacheRead: u.cost.cacheRead,
			costCacheWrite: u.cost.cacheWrite,
			costTotal: u.cost.total,
			toolCalls: countToolCalls(msg),
		});
	}

	return rows;
}

export type CostlySummary = {
	requestCount: number;
	totalCost: number;
	totalInput: number;
	totalOutput: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalTokens: number;
	totalToolCalls: number;
	/** cacheRead / (input + cacheRead), 0 if denominator is 0 */
	cacheReadRatio: number;
	models: string[];
};

export function summarize(rows: CostlyRow[]): CostlySummary {
	let totalCost = 0;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalTokens = 0;
	let totalToolCalls = 0;
	const modelSet = new Set<string>();

	for (const r of rows) {
		totalCost += r.costTotal;
		totalInput += r.input;
		totalOutput += r.output;
		totalCacheRead += r.cacheRead;
		totalCacheWrite += r.cacheWrite;
		totalTokens += r.totalTokens;
		totalToolCalls += r.toolCalls;
		modelSet.add(`${r.provider}/${r.model}`);
	}

	const denom = totalInput + totalCacheRead;
	const cacheReadRatio = denom > 0 ? totalCacheRead / denom : 0;

	return {
		requestCount: rows.length,
		totalCost,
		totalInput,
		totalOutput,
		totalCacheRead,
		totalCacheWrite,
		totalTokens,
		totalToolCalls,
		cacheReadRatio,
		models: [...modelSet],
	};
}
