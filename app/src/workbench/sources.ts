import type { SwiftType } from "../engine/swiftTypes";
import type { Fn, Program, TableRow } from "./model";
import { sourcePaths } from "./sidebar/model";

/** Paths the Swift compiler inlines from its own library; they aren't the app's files. */
const LIBRARY = /^(?:Swift|_Concurrency|_StringProcessing|Observation|Distributed|RegexBuilder|Synchronization)\//;
const MAX_STRINGS = 8;

export type GuessedFile = { readonly file: string; readonly type: string };

export type SourceFiles = {
  readonly paths: readonly string[];
  readonly library: readonly string[];
  /** One file per top-level Swift type that no path accounts for, named after the type. */
  readonly guessed: readonly GuessedFile[];
};

export function stemOf(file: string): string {
  const name = file.split("/").pop() ?? file;
  return (name.replace(/\.[^.]+$/, "").split("+")[0] ?? name).trim();
}

export function sourceFiles(strings: readonly string[], types: readonly SwiftType[]): SourceFiles {
  const all = sourcePaths(strings);
  const paths = all.filter((path) => !LIBRARY.test(path));
  const taken = new Set(paths.map(stemOf));
  const guessed = new Map<string, GuessedFile>();
  for (const type of types) {
    const top = type.name.split(".")[0] ?? "";
    if (!top || top.startsWith("_") || taken.has(top) || guessed.has(top)) continue;
    guessed.set(top, { file: `${top}.swift`, type: top });
  }
  return { paths, library: all.filter((path) => LIBRARY.test(path)), guessed: [...guessed.values()].sort((a, b) => a.file.localeCompare(b.file)) };
}

export type TraceReason = "metadata" | "accessor" | "path" | "named";

export type TracedFn = { readonly addr: string; readonly why: TraceReason };

export type FileTrace = {
  readonly file: string;
  readonly guessed: boolean;
  readonly types: readonly SwiftType[];
  readonly fns: readonly TracedFn[];
  readonly strings: readonly string[];
};

const typeIndexes = new WeakMap<readonly SwiftType[], ReadonlyMap<string, readonly SwiftType[]>>();

function typesByTop(types: readonly SwiftType[]): ReadonlyMap<string, readonly SwiftType[]> {
  const cached = typeIndexes.get(types);
  if (cached) return cached;
  const index = new Map<string, SwiftType[]>();
  for (const type of types) {
    const top = type.name.split(".")[0] ?? "";
    const list = index.get(top);
    if (list) list.push(type);
    else index.set(top, [type]);
  }
  typeIndexes.set(types, index);
  return index;
}

/** The file's own types: the one it's named after and everything nested in it. */
export function typesOfFile(file: string, types: readonly SwiftType[]): readonly SwiftType[] {
  return typesByTop(types).get(stemOf(file)) ?? [];
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A name mentions the type plainly (`Type.method`) or mangled with its length (`30Type`). */
function mentions(stem: string): RegExp {
  const name = escaped(stem);
  return new RegExp(`(?:^|[^A-Za-z0-9_])${name}(?:$|[^A-Za-z0-9_])|(?<![0-9])${stem.length}${name}`);
}

const WORD = /^[A-Za-z0-9_]+$/;

/** Every name `mentions` could find in a function name, so a lookup gives the same answer as the regex. */
function mentioned(name: string): readonly string[] {
  const found = name.split(/[^A-Za-z0-9_]+/).filter(Boolean);
  for (const run of name.matchAll(/(?<![0-9])[1-9][0-9]*/g)) {
    const start = run.index + run[0].length;
    const end = start + Number(run[0]);
    if (end <= name.length) found.push(name.slice(start, end));
  }
  return found;
}

type FnIndex = { readonly known: ReadonlySet<string>; readonly byName: ReadonlyMap<string, readonly string[]> };

const fnIndexes = new WeakMap<readonly Fn[], FnIndex>();

/** Built once per function list: a large binary has hundreds of thousands of functions and thousands of files. */
function fnIndex(functions: readonly Fn[]): FnIndex {
  const cached = fnIndexes.get(functions);
  if (cached) return cached;
  const byName = new Map<string, string[]>();
  for (const fn of functions) {
    if (fn.kind !== "function") continue;
    for (const name of mentioned(fn.name)) {
      const addrs = byName.get(name);
      if (!addrs) byName.set(name, [fn.addr]);
      else if (addrs.at(-1) !== fn.addr) addrs.push(fn.addr);
    }
  }
  const index = { known: new Set(functions.map((fn) => fn.addr)), byName };
  fnIndexes.set(functions, index);
  return index;
}

function namedAfter(stem: string, functions: readonly Fn[]): readonly string[] {
  if (WORD.test(stem)) return fnIndex(functions).byName.get(stem) ?? [];
  const named = mentions(stem);
  return functions.filter((fn) => fn.kind === "function" && named.test(fn.name)).map((fn) => fn.addr);
}

/** What the binary ties to a file without asking the engine: the types' metadata and the function names. */
export function traceStatic(file: string, guessed: boolean, types: readonly SwiftType[], functions: readonly Fn[], strings: readonly TableRow[]): FileTrace {
  const own = typesOfFile(file, types);
  const { known } = fnIndex(functions);
  const fns = new Map<string, TracedFn>();
  const add = (addr: string, why: TraceReason): void => {
    if (known.has(addr) && !fns.has(addr)) fns.set(addr, { addr, why });
  };
  for (const type of own) {
    for (const method of type.methods) add(method, "metadata");
    if (type.accessor) add(type.accessor, "accessor");
  }
  const stem = stemOf(file);
  for (const addr of namedAfter(stem, functions)) add(addr, "named");
  const said = strings.filter((row) => row.b.includes(stem)).slice(0, MAX_STRINGS).map((row) => row.b);
  return { file, guessed, types: own, fns: [...fns.values()], strings: said };
}

/** Adds the functions that use the file's path, which Swift leaves behind for asserts and logging. */
export async function traceFile(program: Program, file: string, guessed: boolean, types: readonly SwiftType[]): Promise<FileTrace> {
  const base = traceStatic(file, guessed, types, program.functions, program.strings);
  const codeUsing = program.codeUsing;
  if (guessed || !codeUsing) return base;
  const { known } = fnIndex(program.functions);
  const sites = program.strings.filter((row) => row.b.includes(file));
  const users = (await Promise.all(sites.map(async (row) => {
    try {
      return await codeUsing(row.a);
    } catch {
      return [];
    }
  }))).flat();
  const seen = new Set(base.fns.map((fn) => fn.addr));
  const extra = [...new Set(users)].filter((addr) => known.has(addr) && !seen.has(addr)).map((addr): TracedFn => ({ addr, why: "path" }));
  return { ...base, fns: [...base.fns, ...extra] };
}
