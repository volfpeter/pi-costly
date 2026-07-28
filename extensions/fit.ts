/**
 * Ordinary least-squares quadratic fit: y ≈ a + b x + c x²
 * Used for cumulative-cost trend vs request index.
 */

export type QuadFit = {
	/** intercept */
	a: number;
	/** linear coeff */
	b: number;
	/** quadratic coeff */
	c: number;
	/** coefficient of determination in [0, 1], or 0 if undefined */
	r2: number;
	/** fitted ŷ at each x */
	series: number[];
};

/** Solve 3×3 system [A|b] via Gaussian elimination. Rows are [a00,a01,a02,b0]. */
function solve3(
	r0: [number, number, number, number],
	r1: [number, number, number, number],
	r2: [number, number, number, number],
): [number, number, number] | undefined {
	const m: [number, number, number, number][] = [
		[r0[0], r0[1], r0[2], r0[3]],
		[r1[0], r1[1], r1[2], r1[3]],
		[r2[0], r2[1], r2[2], r2[3]],
	];

	for (let col = 0; col < 3; col++) {
		// Pivot
		let best = col;
		for (let row = col + 1; row < 3; row++) {
			if (Math.abs(m[row]![col]!) > Math.abs(m[best]![col]!)) best = row;
		}
		if (Math.abs(m[best]![col]!) < 1e-18) return undefined;
		if (best !== col) {
			const tmp = m[col]!;
			m[col] = m[best]!;
			m[best] = tmp;
		}
		// Eliminate
		const pivot = m[col]![col]!;
		for (let row = col + 1; row < 3; row++) {
			const f = m[row]![col]! / pivot;
			for (let j = col; j < 4; j++) {
				m[row]![j]! -= f * m[col]![j]!;
			}
		}
	}

	// Back-sub
	const x: [number, number, number] = [0, 0, 0];
	for (let i = 2; i >= 0; i--) {
		let sum = m[i]![3]!;
		for (let j = i + 1; j < 3; j++) sum -= m[i]![j]! * x[j]!;
		const diag = m[i]![i]!;
		if (Math.abs(diag) < 1e-18) return undefined;
		x[i] = sum / diag;
	}
	return x;
}

/**
 * Fit y ≈ a + b x + c x². Needs at least 4 points.
 * xs/ys must be same length; non-finite values rejected.
 */
export function fitQuadratic(
	xs: number[],
	ys: number[],
): QuadFit | undefined {
	const n = xs.length;
	if (n < 4 || ys.length !== n) return undefined;

	let S0 = 0,
		S1 = 0,
		S2 = 0,
		S3 = 0,
		S4 = 0;
	let T0 = 0,
		T1 = 0,
		T2 = 0;

	for (let i = 0; i < n; i++) {
		const x = xs[i]!;
		const y = ys[i]!;
		if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
		const x2 = x * x;
		const x3 = x2 * x;
		const x4 = x2 * x2;
		S0 += 1;
		S1 += x;
		S2 += x2;
		S3 += x3;
		S4 += x4;
		T0 += y;
		T1 += x * y;
		T2 += x2 * y;
	}

	const coeffs = solve3([S0, S1, S2, T0], [S1, S2, S3, T1], [S2, S3, S4, T2]);
	if (!coeffs) return undefined;
	const [a, b, c] = coeffs;

	const series: number[] = new Array(n);
	let ssTot = 0;
	let ssRes = 0;
	const mean = T0 / n;
	for (let i = 0; i < n; i++) {
		const x = xs[i]!;
		const y = ys[i]!;
		const yHat = a + b * x + c * x * x;
		series[i] = yHat;
		const dy = y - mean;
		ssTot += dy * dy;
		const re = y - yHat;
		ssRes += re * re;
	}

	const r2 = ssTot < 1e-18 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));

	return { a, b, c, r2, series };
}
