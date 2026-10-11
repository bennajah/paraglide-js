/**
 * Source template for the generated `t.js` file.
 *
 * Ships `t` from `paraglide/messages` next to `m`:
 *
 * ```ts
 * import { m, t } from "./paraglide/messages.js";
 * m.welcome(); // direct, tree-shakeable message call
 * t("welcome"); // dynamic lookup by message id
 * t("Hello {name}!", { name: "Ada" }); // inline source text as key
 * ```
 *
 * Message ids and inline source text share one lookup: `t(key)` reads
 * `messages/_index.js` (which exports every bundle under its raw id via
 * `export { safe as "raw id" }`), so it works in both output structures
 * (`message-modules` and `locale-modules`) without duplicating the
 * safe-module-id logic.
 *
 * A missing key falls back to formatting the key itself as inline English
 * (`{placeholders}` are interpolated, other ICU is left untouched), so
 * freshly written `t("...")` strings render before the next extraction
 * + compilation picks them up.
 */
export function createTFunctionFile(): string {
	const lines = [
		'import * as m from "./messages/_index.js";',
		'',
		'/**',
		' * Dynamic message lookup by id or inline source text.',
		' *',
		' * Compatible with `@inlang/plugin-t-function-matcher` (Sherlock IDE).',
		' *',
		' * @param {string | { message: string, description?: string, id?: string }} keyOrSource - Message id (e.g. `t("welcome")`), inline source text (e.g. `t("Hello {name}!")`), or `{ message, description?, id? }` for translator context / explicit ids.',
		' * @param {Record<string, unknown>} [params] - Interpolation / ICU parameters.',
		' * @param {{ locale?: import("./runtime.js").Locale }} [options] - Optional locale override, same as `m.*` message functions.',
		' * @returns {import("./runtime.js").LocalizedString} The translated message, or the key/source formatted with `params` when untranslated.',
		' */',
		'export function t(keyOrSource, params = {}, options) {',
		'\tconst source = typeof keyOrSource === "string" ? keyOrSource : keyOrSource.message;',
		'\tconst key = typeof keyOrSource === "string" ? keyOrSource : (keyOrSource.id ?? keyOrSource.message);',
		'\tconst registry = /** @type {Record<string, unknown>} */ (m);',
		'\tconst fn = registry[key];',
		'\tif (typeof fn === "function") {',
		'\t\treturn /** @type {(params: unknown, options?: unknown) => import("./runtime.js").LocalizedString} */ (fn)(params, options);',
		'\t}',
		'\treturn formatInlineSource(source, params);',
		'}',
		'',
		'/**',
		' * Minimal fallback formatter for untranslated keys.',
		' *',
		' * Interpolates `{placeholder}` occurrences and leaves any other ICU',
		' * syntax untouched. Fully compiled messages (with plural/select support)',
		' * take over once the key exists in the catalog.',
		' *',
		' * @param {string} source - Inline source text (or the missing key itself).',
		' * @param {Record<string, unknown>} params - Interpolation parameters.',
		' * @returns {import("./runtime.js").LocalizedString} The formatted source text.',
		' */',
		'function formatInlineSource(source, params) {',
		'\tconst out = source.replace(/\\{(\\w+)\\}/g, (match, name) => {',
		'\t\tconst value = params[name];',
		'\t\treturn value === undefined ? match : String(value);',
		'\t});',
		'\treturn /** @type {unknown} */ (out);',
		'}',
	];
	return `${lines.join("\n")}\n`;
}