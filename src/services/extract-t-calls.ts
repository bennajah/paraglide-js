import { promises as fsp } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SCAN_EXTENSIONS = new Set([
	".astro",
	".ts",
	".js",
	".tsx",
	".jsx",
	".svelte",
	".vue",
	".mjs",
	".cjs",
]);

const T_CALL_RE = /\bt\(\s*/g;
const PROP_QUOTE_RE = /(?:message|id)\s*:\s*(['"`])/g;
const HEX_RE = /^[0-9a-fA-F]{4}$/;
const WHITESPACE_RE = /\s/;
const COMMENT_LINE_RE = /^\s*(\/\/|\/\*|\*|<!--)/;

export type ExtractedTCallMessage = {
	/** Catalog id (`{ id }` when explicit, otherwise the message itself). */
	id: string;
	message: string;
};

export type ExtractTCallsOptions = {
	projectDir?: string;
	rootDir?: string;
	srcDir?: string;
	/** Scan only these files (watch mode); otherwise the whole source directory is scanned. */
	files?: string[];
};

export type ExtractTCallsResult = {
	added: number;
	scanned: number;
	dirty: boolean;
	skippedDynamic: number;
};

type ParsedStringLiteral = {
	end: number;
	value: string;
};

type FirstArg =
	| { kind: "string"; raw?: string; dynamic?: boolean }
	| { kind: "object"; body?: string; dynamic?: boolean }
	| { kind: "other" };

function hasScanExtension(name: string): boolean {
	for (const ext of SCAN_EXTENSIONS) {
		if (name.endsWith(ext)) return true;
	}
	return false;
}

/**
 * True for source files the extractor scans (excludes generated output).
 */
export function isExtractablePath(filePath: string, srcDir: string): boolean {
	const normalized = filePath.replace(/\\/g, "/");
	const root = srcDir.replace(/\\/g, "/");
	if (normalized === root || !normalized.startsWith(`${root}/`)) return false;
	if (normalized.includes("/paraglide/")) return false;
	const lastSlash = normalized.lastIndexOf("/");
	return hasScanExtension(normalized.slice(lastSlash + 1));
}

function skipWhitespace(src: string, from: number): number {
	let index = from;
	while (index < src.length && WHITESPACE_RE.test(src[index] ?? "")) {
		index += 1;
	}
	return index;
}

function readEscape(
	src: string,
	backslashAt: number
): { char: string; end: number } {
	const next = src[backslashAt + 1] ?? "";
	if (next === "n") return { char: "\n", end: backslashAt + 2 };
	if (next === "r") return { char: "\r", end: backslashAt + 2 };
	if (next === "t") return { char: "\t", end: backslashAt + 2 };
	if (next === "u") {
		const hex = src.slice(backslashAt + 2, backslashAt + 6);
		if (HEX_RE.test(hex)) {
			return {
				char: String.fromCharCode(Number.parseInt(hex, 16)),
				end: backslashAt + 6,
			};
		}
	}
	return { char: next, end: backslashAt + 2 };
}

function parseStringLiteral(
	src: string,
	start: number
): ParsedStringLiteral | null {
	const quote = src[start];
	if (quote !== "'" && quote !== '"' && quote !== "`") return null;
	let out = "";
	let i = start + 1;
	while (i < src.length) {
		const c = src[i] ?? "";
		if (quote === "`" && c === "$" && src[i + 1] === "{") return null;
		if (c === "\\") {
			const escaped = readEscape(src, i);
			out += escaped.char;
		i = escaped.end;
			continue;
		}
		if (c === quote) return { end: i + 1, value: out };
		if (c === "\n" && quote !== "`") return null;
		out += c;
		i += 1;
	}
	return null;
}

function scanBalancedBraces(src: string, openAt: number): string | null {
	let depth = 0;
	let j = openAt;
	while (j < src.length) {
		const ch = src[j] ?? "";
		if (ch === "'" || ch === '"' || ch === "`") {
			const parsed = parseStringLiteral(src, j);
			if (parsed === null) return null;
			j = parsed.end;
			continue;
		}
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) return src.slice(openAt, j + 1);
		}
		j += 1;
	}
	return null;
}

function parseFirstArg(src: string, openParen: number): FirstArg {
	const i = skipWhitespace(src, openParen + 1);
	const c = src[i];
	if (c === "'" || c === '"' || c === "`") {
		const parsed = parseStringLiteral(src, i);
		if (parsed === null) return { dynamic: true, kind: "string" };
		return { kind: "string", raw: parsed.value };
	}
	if (c === "{") {
		const body = scanBalancedBraces(src, i);
		if (body === null) return { dynamic: true, kind: "object" };
		return { body, kind: "object" };
	}
	return { kind: "other" };
}

function extractObjectProps(body: string): {
	id: string | null;
	message: string | null;
} {
	let id: string | null = null;
	let message: string | null = null;
	for (const match of body.matchAll(PROP_QUOTE_RE)) {
		const prop = match[0].startsWith("message") ? "message" : "id";
		const quoteAt = (match.index ?? 0) + match[0].length - 1;
		const parsed = parseStringLiteral(body, quoteAt);
		if (parsed === null) continue;
		if (prop === "message") message = parsed.value;
		else id = parsed.value;
	}
	return { id, message };
}

function isCommentLine(source: string, matchIndex: number): boolean {
	const lineStart = source.lastIndexOf("\n", matchIndex - 1) + 1;
	return COMMENT_LINE_RE.test(source.slice(lineStart, matchIndex));
}

function scanFileCalls(source: string): {
	found: { id: string | null; message: string }[];
	skippedDynamic: number;
} {
	const found: { id: string | null; message: string }[] = [];
	let skippedDynamic = 0;
	for (const match of source.matchAll(T_CALL_RE)) {
		const at = match.index ?? 0;
		if (isCommentLine(source, at)) continue;
		const arg = parseFirstArg(source, at + match[0].length - 1);
		if (arg.kind === "string") {
			if (arg.dynamic === true || arg.raw === undefined || arg.raw === "") {
				skippedDynamic += 1;
				continue;
			}
			found.push({ id: null, message: arg.raw });
		} else if (arg.kind === "object") {
			if (arg.dynamic === true || arg.body === undefined) {
				skippedDynamic += 1;
				continue;
			}
			const { id, message } = extractObjectProps(arg.body);
			if (message === null || message === "") {
				skippedDynamic += 1;
				continue;
			}
			found.push({ id, message });
		}
	}
	return { found, skippedDynamic };
}

/**
 * Pure, filesystem-free scan of `t("...")` calls in source text.
 *
 * Exported so the extractor can be unit tested without touching the disk.
 */
export function extractTCallMessages(source: string): ExtractedTCallMessage[] {
	const { found } = scanFileCalls(source);
	return found.map((item) => ({
		id: item.id ?? item.message,
		message: item.message,
	}));
}

async function walk(dir: string): Promise<string[]> {
	const entries = await fsp.readdir(dir, { withFileTypes: true });
	const nested = await Promise.all(
		entries
			.filter(
				(entry) =>
					entry.isDirectory() &&
					entry.name !== "paraglide" &&
					!entry.name.startsWith(".")
			)
			.map((entry) => walk(join(dir, entry.name)))
	);
	const files = entries
		.filter((entry) => entry.isFile() && hasScanExtension(entry.name))
		.map((entry) => join(dir, entry.name));
	return [...files, ...nested.flat()];
}

type ProjectSettings = {
	baseLocale: string;
	locales: string[];
	"plugin.inlang.messageFormat"?: {
		pathPattern?: string;
	};
};

function serializeCatalog(
	schema: unknown,
	data: Record<string, unknown>
): string {
	const out: Record<string, unknown> = {};
	if (schema !== undefined) out.$schema = schema;
	for (const [key, value] of Object.entries(data)) out[key] = value;
	return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Scans `t("...")` calls under the project source directory and syncs any
 * missing messages into the message catalogs.
 *
 * The literal (or `{ message }`) is used as its own message id, mirroring
 * `useExtracted` semantics: colocation without manual keys. The source
 * locale receives `message -> message`; other locales receive
 * `message -> ""`. Existing entries are never overwritten.
 *
 * Idempotent: catalog files are only written when entries are missing.
 */
export async function extractTCalls(
	args: ExtractTCallsOptions = {}
): Promise<ExtractTCallsResult> {
	const projectDir = resolve(args.projectDir ?? join(process.cwd(), "project.inlang"));
	const rootDir = resolve(args.rootDir ?? dirname(projectDir));
	const settingsRaw = await fsp.readFile(
		join(projectDir, "settings.json"),
		"utf8"
	);
	const settings = JSON.parse(settingsRaw) as ProjectSettings;
	const baseLocale = settings.baseLocale;
	const locales = settings.locales;
	const pathPattern =
		settings["plugin.inlang.messageFormat"]?.pathPattern ??
		"./messages/{locale}.json";
	const messagesFile = (locale: string): string =>
		pathPattern.startsWith("/")
			? pathPattern.replace("{locale}", locale)
			: resolve(rootDir, pathPattern.replace("{locale}", locale));
	const srcDir = resolve(args.srcDir ?? join(rootDir, "src"));

	const files = args.files ?? (await walk(srcDir).catch(() => []));
	const reads = await Promise.all(
		files.map(async (file) => ({
			file,
			source: await fsp.readFile(file, "utf8"),
		}))
	);
	const messages = new Map<string, string>();
	let skippedDynamic = 0;
	for (const { source } of reads) {
		const { found, skippedDynamic: skipped } = scanFileCalls(source);
		skippedDynamic += skipped;
		for (const item of found) {
			const id = item.id ?? item.message;
			if (!messages.has(id)) messages.set(id, item.message);
		}
	}

	let added = 0;
	for (const locale of locales) {
		const target = messagesFile(locale);
		const raw = await fsp.readFile(target, "utf8");
		const data = JSON.parse(raw) as Record<string, unknown>;
		const { $schema, ...rest } = data as { $schema?: unknown } & Record<
			string,
			unknown
		>;
		let dirty = false;
		for (const id of [...messages.keys()].sort()) {
			if (!(id in rest)) {
				rest[id] = locale === baseLocale ? messages.get(id) : "";
				dirty = true;
				added += 1;
			}
		}
		if (dirty) await fsp.writeFile(target, serializeCatalog($schema, rest), "utf8");
	}
	return { added, scanned: files.length, dirty: added > 0, skippedDynamic };
}
