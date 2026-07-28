import { dirname, resolve, sep } from "node:path";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";

/** True if sessionCwd is dir or a descendant of dir. Empty sessionCwd never matches. */
export function isUnderDir(sessionCwd: string, dir: string): boolean {
	if (!sessionCwd) return false;
	const s = resolve(sessionCwd);
	const d = resolve(dir);
	if (s === d) return true;
	const prefix = d.endsWith(sep) ? d : d + sep;
	return s.startsWith(prefix);
}

function compareBucket(a: SessionInfo, b: SessionInfo): number {
	const byPath = (a.cwd || "").localeCompare(b.cwd || "");
	if (byPath !== 0) return byPath;
	// Newer first
	const byMod = b.modified.getTime() - a.modified.getTime();
	if (byMod !== 0) return byMod;
	return a.id.localeCompare(b.id);
}

/**
 * Sort sessions by proximity to cwd:
 * walk cwd → parent → … → root; at each dir take remaining sessions whose
 * session.cwd is under that dir; sort bucket by path, then newer first, then id.
 * Leftovers (empty cwd / outside tree) append last, same tie-break.
 */
export function sortSessionsByProximity(
	sessions: SessionInfo[],
	cwd: string,
): SessionInfo[] {
	const remaining = new Set(sessions);
	const result: SessionInfo[] = [];

	let dir = resolve(cwd || ".");
	// Walk until root (dirname('/') === '/' on POSIX)
	for (;;) {
		if (remaining.size === 0) break;

		const bucket: SessionInfo[] = [];
		for (const s of remaining) {
			if (isUnderDir(s.cwd || "", dir)) bucket.push(s);
		}
		bucket.sort(compareBucket);
		for (const s of bucket) {
			result.push(s);
			remaining.delete(s);
		}

		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	const rest = [...remaining].sort(compareBucket);
	result.push(...rest);
	return result;
}
