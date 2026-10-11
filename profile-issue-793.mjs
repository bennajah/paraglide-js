import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { performance } from "node:perf_hooks";
import { createRegistry } from "./src/compiler/registry.ts";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const baselineSource = execFileSync(
	"git",
	["show", "961714101d0bdcf8babaf9c241a8a4b8b6289e0e:src/compiler/registry.ts"],
	{ encoding: "utf8" }
);
const baselineCompiler = await import(
	`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(baselineSource)).toString("base64")}`
);
const load = async (source) => {
	const registry = await import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
	);
	// The compiler marks its plain option literals cacheable. Apply the same
	// call shape to both versions; the baseline ignores the extra argument.
	return Object.fromEntries(
		Object.entries(registry).map(([name, fn]) => [
			name,
			(locale, input, options) => fn(locale, input, options, true),
		])
	);
};
const baseline = await load(baselineCompiler.createRegistry());
const current = await load(createRegistry());
let runtime = "native Intl";
if (process.argv.includes("--polyfill")) {
	const packagePath = resolve(
		process.env.PARAGLIDE_PLURALRULES_PATH ??
			"node_modules/@formatjs/intl-pluralrules"
	);
	const { version } = JSON.parse(
		readFileSync(resolve(packagePath, "package.json"), "utf8")
	);
	assert.equal(version, "6.3.15");
	runtime = `FormatJS PluralRules ${version}`;
	await import(pathToFileURL(resolve(packagePath, "polyfill-force.js")).href);
	for (const locale of ["en", "es", "fr", "zh", "pt"]) {
		await import(
			pathToFileURL(resolve(packagePath, `locale-data/${locale}.js`)).href
		);
	}
}
const cases = [
	["plural", (r, i) => r.plural("en", i % 20, { type: "cardinal" })],
	[
		"plural 5 locales",
		(r, i) =>
			r.plural(["en", "es-419", "fr-CA", "zh-Hant", "pt-PT"][i % 5], i % 20, {
				type: "cardinal",
			}),
	],
	["ordinal", (r, i) => r.plural("en", i % 20, { type: "ordinal" })],
	[
		"number",
		(r, i) => r.number("en", i, { style: "currency", currency: "USD" }),
	],
	[
		"datetime",
		(r, i) =>
			r.datetime("en", 1700000000000 + i, {
				timeZone: "UTC",
				dateStyle: "short",
			}),
	],
	[
		"datetime default zone (uncached)",
		(r, i) => r.datetime("en", 1700000000000 + i, { dateStyle: "short" }),
	],
	[
		"relativetime",
		(r, i) => r.relativetime("en", i % 20, { unit: "day", numeric: "auto" }),
	],
	[
		"number 80 keys",
		(r, i) =>
			r.number("en", i, {
				minimumIntegerDigits: (i % 20) + 1,
				minimumFractionDigits: Math.floor((i % 80) / 20),
			}),
	],
	[
		"number 200 keys",
		(r, i) =>
			r.number("en", i, {
				minimumIntegerDigits: (i % 20) + 1,
				minimumFractionDigits: Math.floor((i % 200) / 20),
			}),
	],
	[
		"number 500 keys (churn)",
		(r, i) =>
			r.number("en", i, {
				minimumIntegerDigits: (i % 20) + 1,
				minimumFractionDigits: Math.floor((i % 500) / 20),
			}),
	],
];
const iterations = 3000;
const rounds = 7;
const measure = (registry, fn) => {
	const start = performance.now();
	let checksum = 0;
	for (let i = 0; i < iterations; i++) checksum += fn(registry, i).length;
	return { us: ((performance.now() - start) * 1000) / iterations, checksum };
};
console.log(
	`Node ${process.version}; ${process.platform}/${process.arch}; ${runtime}; median of ${rounds} alternating rounds, ${iterations} calls/round`
);
for (const [name, fn] of cases) {
	for (let i = 0; i < 300; i++) assert.equal(fn(current, i), fn(baseline, i));
	const before = [],
		after = [];
	for (let round = 0; round < rounds; round++) {
		const order =
			round % 2
				? [
						[current, after],
						[baseline, before],
					]
				: [
						[baseline, before],
						[current, after],
					];
		const results = order.map(([registry, samples]) => {
			const result = measure(registry, fn);
			samples.push(result.us);
			return result;
		});
		assert.equal(results[0].checksum, results[1].checksum);
	}
	const median = (samples) =>
		samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
	const b = median(before),
		a = median(after);
	console.log(
		`${name}: before ${b.toFixed(3)} us; after ${a.toFixed(3)} us; ${(b / a).toFixed(2)}x faster`
	);
}
