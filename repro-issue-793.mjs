import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	createRegistry,
	registryFunctionCode,
	withRegistryDependencies,
} from "./src/compiler/registry.ts";

// Run with Node >= 22.18: node repro-issue-793.mjs
const calls = 100;
const expectedConstructions = process.argv.includes("--expect-uncached")
	? calls
	: 1;
const cases = [
	["plural", "PluralRules", () => ["en", 2, { type: "cardinal" }], "other"],
	[
		"plural ordinal",
		"PluralRules",
		() => ["en", 2, { type: "ordinal" }],
		"two",
	],
	["plural offset", "PluralRules", () => ["en", 2, { offset: 1 }], "one"],
	[
		"number",
		"NumberFormat",
		() => ["en", 1234.5, { useGrouping: false }],
		"1234.5",
	],
	[
		"datetime",
		"DateTimeFormat",
		() => ["en", "2026-10-11T00:00:00Z", { timeZone: "UTC", year: "numeric" }],
		"2026",
	],
	[
		"relativetime",
		"RelativeTimeFormat",
		() => ["en", -1, { unit: "day", numeric: "auto" }],
		"yesterday",
	],
];

console.log(
	`Main commit: ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: import.meta.dirname, encoding: "utf8" }).trim()}`
);
console.log(
	`Runtime: ${process.version}; ${calls} identical locale/options calls per case`
);

const sources = [
	["generated registry.js", createRegistry()],
	[
		"server-inlined registry functions",
		Object.values(
			registryFunctionCode(
				withRegistryDependencies([
					"plural",
					"number",
					"datetime",
					"relativetime",
				])
			)
		)
			.map((code) => `export ${code}`)
			.join("\n"),
	],
];

for (const [label, source] of sources) {
	const registry = await import(
		`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
	);
	console.log(`\n${label}:`);
	for (const [name, constructorName, args, expected] of cases) {
		const Original = Intl[constructorName];
		let constructions = 0;
		Intl[constructorName] = new Proxy(Original, {
			construct(target, parameters, newTarget) {
				constructions++;
				return Reflect.construct(target, parameters, newTarget);
			},
		});
		try {
			const fn = registry[name.split(" ")[0]];
			for (let i = 0; i < calls; i++) {
				assert.equal(fn(...args(), true), expected);
			}
		} finally {
			Intl[constructorName] = Original;
		}
		assert.equal(
			constructions,
			expectedConstructions,
			`${name}: unexpected construction count`
		);
		console.log(
			`  ${name}: ${constructions} Intl.${constructorName} constructions / ${calls} calls; output correct`
		);
	}
}

console.log(
	expectedConstructions === 1
		? "\nFixed #793: repeated calls reuse one formatter per locale/options."
		: "\nReproduced #793: every invocation constructs a formatter."
);
console.log(
	"Hermes/React Native performance figures are not measured by this Node reproduction."
);
