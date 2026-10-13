import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadBoardManifest } from "lib/dev/multi-board/board-manifest"
import { temporaryDirectory } from "tempy"

const makeBoard = (root: string, dir: string, withJson = true) => {
  mkdirSync(join(root, dir, "dist", "index"), { recursive: true })
  writeFileSync(join(root, dir, "index.tsx"), "export default () => null\n")
  if (withJson) writeFileSync(join(root, dir, "dist/index/circuit.json"), "[]")
}

test("parses a manifest with paths relative to the manifest file", () => {
  const root = temporaryDirectory()
  makeBoard(root, "boards/a")
  writeFileSync(
    join(root, "boards.json"),
    JSON.stringify({
      boards: [
        { id: "a", label: "Board A", dir: "boards/a", entry: "index.tsx" },
      ],
    }),
  )
  const [b] = loadBoardManifest("boards.json", root)
  expect(b!.label).toBe("Board A")
  expect(b!.absDir).toBe(join(root, "boards/a"))
  expect(b!.absEntry).toBe(join(root, "boards/a/index.tsx"))
  expect(b!.absPreroutedJson).toBe(
    join(root, "boards/a/dist/index/circuit.json"),
  )
})

test("defaults label to id and finds first dist/**/circuit.json", () => {
  const root = temporaryDirectory()
  mkdirSync(join(root, "x/dist/other"), { recursive: true })
  writeFileSync(join(root, "x/dist/other/circuit.json"), "[]")
  writeFileSync(
    join(root, "m.json"),
    JSON.stringify({ boards: [{ id: "x", dir: "x" }] }),
  )
  const [b] = loadBoardManifest("m.json", root)
  expect(b!.label).toBe("x")
  expect(b!.absPreroutedJson).toBe(join(root, "x/dist/other/circuit.json"))
})

test("glob mode derives ids from basenames and dedupes", () => {
  const root = temporaryDirectory()
  makeBoard(root, "g1/foo")
  makeBoard(root, "g2/foo")
  makeBoard(root, "g1/bar")
  const boards = loadBoardManifest("g*/*", root)
  expect(boards.map((b) => b.id).sort()).toEqual(["bar", "foo", "foo-2"])
})

test("rejects a bad id, duplicate ids and a missing dir", () => {
  const root = temporaryDirectory()
  makeBoard(root, "a")
  const write = (boards: unknown[]) =>
    writeFileSync(join(root, "m.json"), JSON.stringify({ boards }))
  write([{ id: "-bad", dir: "a" }])
  expect(() => loadBoardManifest("m.json", root)).toThrow()
  write([
    { id: "a", dir: "a" },
    { id: "a", dir: "a" },
  ])
  expect(() => loadBoardManifest("m.json", root)).toThrow(/Duplicate/)
  write([{ id: "z", dir: "nope" }])
  expect(() => loadBoardManifest("m.json", root)).toThrow(/not found/)
})

test("glob: basename failing the id regex is sanitized, not fatal", () => {
  const root = temporaryDirectory()
  makeBoard(root, "g/_shared")
  makeBoard(root, "g/ok")
  const ids = loadBoardManifest("g/*", root)
    .map((b) => b.id)
    .sort()
  expect(ids).toEqual(["ok", "shared"])
})

test("glob: dedupe suffix never collides with a real dir", () => {
  const root = temporaryDirectory()
  makeBoard(root, "g1/foo")
  makeBoard(root, "g2/foo")
  makeBoard(root, "g3/foo-2")
  const ids = loadBoardManifest("g*/*", root).map((b) => b.id)
  expect(new Set(ids).size).toBe(3)
  expect(ids).toContain("foo-2")
  expect(ids).toContain("foo-3")
})

test("a missing .json manifest is an error, not a glob", () => {
  const root = temporaryDirectory()
  expect(() => loadBoardManifest("nope.json", root)).toThrow(
    /manifest not found/,
  )
})

test("preroutedJson override is honored", () => {
  const root = temporaryDirectory()
  makeBoard(root, "a")
  writeFileSync(join(root, "a/custom.json"), "[]")
  writeFileSync(
    join(root, "m.json"),
    JSON.stringify({
      boards: [{ id: "a", dir: "a", preroutedJson: "custom.json" }],
    }),
  )
  expect(loadBoardManifest("m.json", root)[0]!.absPreroutedJson).toBe(
    join(root, "a/custom.json"),
  )
})
