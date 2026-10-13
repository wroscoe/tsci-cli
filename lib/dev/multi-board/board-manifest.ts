import * as fs from "node:fs"
import * as path from "node:path"
import { globbySync } from "globby"
import { DEFAULT_IGNORED_PATTERNS } from "lib/shared/should-ignore-path"
import { z } from "zod"

export const DEFAULT_PREROUTED_JSON = "dist/index/circuit.json"

export const boardManifestEntrySchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/i,
      "id must match /^[a-z0-9][a-z0-9._-]*$/i",
    ),
  label: z.string().optional(),
  dir: z.string().min(1),
  entry: z.string().optional(),
  preroutedJson: z.string().optional(),
})

export const boardManifestSchema = z.object({
  boards: z.array(boardManifestEntrySchema).min(1),
})

export type BoardManifestEntry = z.infer<typeof boardManifestEntrySchema>
export type BoardManifest = z.infer<typeof boardManifestSchema>

export interface ResolvedBoard {
  id: string
  label: string
  dir: string
  absDir: string
  entry?: string
  absEntry?: string
  preroutedJson: string
  absPreroutedJson: string
}

export interface BoardStatus {
  id: string
  label: string
  hasPrerouted: boolean
  mtimeMs: number | null
  sizeBytes: number | null
}

const findFirstCircuitJson = (absDir: string): string | undefined => {
  const found = globbySync("dist/**/circuit.json", {
    cwd: absDir,
    ignore: DEFAULT_IGNORED_PATTERNS,
  }).sort()
  return found[0]
}

const resolveEntry = (
  entry: BoardManifestEntry,
  baseDir: string,
): ResolvedBoard => {
  const absDir = path.resolve(baseDir, entry.dir)
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new Error(`Board "${entry.id}": directory not found: ${absDir}`)
  }
  const preroutedJson =
    entry.preroutedJson ??
    (fs.existsSync(path.join(absDir, DEFAULT_PREROUTED_JSON))
      ? DEFAULT_PREROUTED_JSON
      : (findFirstCircuitJson(absDir) ?? DEFAULT_PREROUTED_JSON))
  return {
    id: entry.id,
    label: entry.label ?? entry.id,
    dir: entry.dir,
    absDir,
    entry: entry.entry,
    absEntry: entry.entry ? path.resolve(absDir, entry.entry) : undefined,
    preroutedJson,
    absPreroutedJson: path.resolve(absDir, preroutedJson),
  }
}

const assertUniqueIds = (boards: ResolvedBoard[]) => {
  const seen = new Map<string, string>()
  for (const b of boards) {
    const prev = seen.get(b.id)
    if (prev !== undefined) {
      throw new Error(`Duplicate board id: "${b.id}" (${prev} and ${b.absDir})`)
    }
    seen.set(b.id, b.absDir)
  }
}

const sanitizeId = (raw: string): string => {
  const cleaned = raw.replace(/[^a-z0-9._-]/gi, "-").replace(/^[^a-z0-9]+/i, "")
  return cleaned
}

export const loadBoardManifest = (
  specifier: string,
  cwd: string,
): ResolvedBoard[] => {
  const absSpec = path.resolve(cwd, specifier)
  if (specifier.endsWith(".json")) {
    if (!fs.existsSync(absSpec)) {
      throw new Error(`manifest not found: ${absSpec}`)
    }
    const parsed = boardManifestSchema.parse(
      JSON.parse(fs.readFileSync(absSpec, "utf8")),
    )
    const boards = parsed.boards.map((e) =>
      resolveEntry(e, path.dirname(absSpec)),
    )
    assertUniqueIds(boards)
    return boards
  }

  const matches = globbySync(specifier, {
    cwd,
    onlyDirectories: true,
    ignore: DEFAULT_IGNORED_PATTERNS,
  }).sort()
  if (matches.length === 0) {
    throw new Error(`No board directories matched "${specifier}"`)
  }
  // Pass 1: first occurrence of every base keeps its name, so a "-2" suffix
  // can never steal the id of a real directory (e.g. a dir named "foo-2").
  const used = new Set<string>()
  const assigned = new Map<string, string>()
  const bases = new Map<string, string>()
  for (const dir of matches) {
    const base = sanitizeId(path.basename(dir))
    if (!base) {
      console.warn(`Skipping "${dir}": cannot derive a valid board id`)
      continue
    }
    bases.set(dir, base)
    if (!used.has(base.toLowerCase())) {
      used.add(base.toLowerCase())
      assigned.set(dir, base)
    }
  }
  // Pass 2: duplicates get the first unused "-N" suffix.
  for (const [dir, base] of bases) {
    if (assigned.has(dir)) continue
    let n = 2
    while (used.has(`${base}-${n}`.toLowerCase())) n++
    used.add(`${base}-${n}`.toLowerCase())
    assigned.set(dir, `${base}-${n}`)
  }
  const entries: BoardManifestEntry[] = matches
    .filter((d) => assigned.has(d))
    .map((dir) =>
      boardManifestEntrySchema.parse({ id: assigned.get(dir)!, dir }),
    )
  if (entries.length === 0) {
    throw new Error(`No usable board directories matched "${specifier}"`)
  }
  const boards = entries.map((e) => resolveEntry(e, cwd))
  assertUniqueIds(boards)
  return boards
}

export const resolveBoardStatus = (board: ResolvedBoard): BoardStatus => {
  try {
    const st = fs.statSync(board.absPreroutedJson)
    if (!st.isFile()) throw new Error("not a file")
    return {
      id: board.id,
      label: board.label,
      hasPrerouted: true,
      mtimeMs: st.mtimeMs,
      sizeBytes: st.size,
    }
  } catch {
    return {
      id: board.id,
      label: board.label,
      hasPrerouted: false,
      mtimeMs: null,
      sizeBytes: null,
    }
  }
}
