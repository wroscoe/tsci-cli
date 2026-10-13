import { expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import getPort from "get-port"
import { DevServer } from "lib/dev/DevServer"
import { loadBoardManifest } from "lib/dev/multi-board/board-manifest"
import { getMultiBoardLandingHtml } from "lib/site/get-multi-board-landing-html"
import { getMultiBoardRunframeHtml } from "lib/site/get-multi-board-runframe-html"
import { temporaryDirectory } from "tempy"

const CIRCUIT = '[{"type":"source_board","source_board_id":"b"}]'

const setup = async () => {
  const root = temporaryDirectory()
  for (const id of ["a", "b"]) {
    mkdirSync(join(root, id, "dist/index"), { recursive: true })
    writeFileSync(join(root, id, "index.tsx"), "export default () => null\n")
    writeFileSync(join(root, id, "dist/index/circuit.json"), CIRCUIT)
  }
  const boards = loadBoardManifest("*", root)
  const port = await getPort()
  const server = new DevServer({
    port,
    componentFilePath: boards[0]!.absEntry ?? boards[0]!.absPreroutedJson,
    projectDir: boards[0]!.absDir,
    boards,
  })
  await server.start()
  globalThis.deferredCleanupFns.push(() => server.stop())
  return { root, port, origin: `http://localhost:${port}` }
}

test("multi-board dev server routes", async () => {
  const { root, origin } = await setup()

  const landing = await (await fetch(`${origin}/`)).text()
  expect(landing).toContain("/b/a")
  expect(landing).toContain("/b/b")

  const page = await (await fetch(`${origin}/b/a`)).text()
  expect(page).toContain("TSCIRCUIT_RUNFRAME_STATIC_FILE_LIST")
  expect(page).toContain("/boards/a/circuit.json")
  expect(page).not.toContain("TSCIRCUIT_REGISTRY_TOKEN")

  const json = await fetch(`${origin}/boards/a/circuit.json`)
  expect(json.headers.get("cache-control")).toBe("no-store")
  expect(await json.text()).toBe(CIRCUIT)

  expect((await fetch(`${origin}/b/zzz`)).status).toBe(404)
  expect(
    (await fetch(`${origin}/boards/..%2F..%2Fetc/circuit.json`)).status,
  ).toBe(404)
  expect((await fetch(`${origin}/b/a%2F..`)).status).toBe(404)
  expect((await fetch(`${origin}/boards/a%2F..%2Fb/circuit.json`)).status).toBe(
    404,
  )
  expect(json.headers.get("content-length")).toBe(String(CIRCUIT.length))
  expect((await fetch(`${origin}/boards/zzz/circuit.json`)).status).toBe(404)

  const before = (await (
    await fetch(`${origin}/api/boards.json`)
  ).json()) as any[]
  expect(before.find((b) => b.id === "a").hasPrerouted).toBe(true)
  rmSync(join(root, "a/dist/index/circuit.json"))
  const after = (await (
    await fetch(`${origin}/api/boards.json`)
  ).json()) as any[]
  expect(after.find((b) => b.id === "a").hasPrerouted).toBe(false)
  expect(after.find((b) => b.id === "b").hasPrerouted).toBe(true)

  expect((await fetch(`${origin}/api/files/list`)).status).toBe(200)
}, 30_000)

test("html generators", () => {
  const statuses = [
    {
      id: "a",
      label: "A </script>",
      hasPrerouted: true,
      mtimeMs: 5,
      sizeBytes: 10,
    },
    {
      id: "b",
      label: "B",
      hasPrerouted: false,
      mtimeMs: null,
      sizeBytes: null,
    },
  ]
  const html = getMultiBoardRunframeHtml({
    board: statuses[0]!,
    boards: statuses,
    mode: "prerouted",
  })
  expect(html).toContain('"filePath":"a/circuit.json"')
  expect(html).toContain("/boards/a/circuit.json?v=5")
  expect(html).toContain("tsci-multiboard-bar")
  expect(html).toContain("coming in phase 2")
  expect(html).not.toContain("A </script>")
  expect(html).toContain("A \\u003c/script>")
  expect(html).toContain("<title>A &lt;/script&gt;</title>")
  expect(html).toContain("/standalone.min.js")

  const landing = getMultiBoardLandingHtml({ boards: statuses })
  expect(landing).toContain('href="/b/a#tab=schematic"')
  expect(landing).toContain("missing")
  expect(landing).not.toContain("A </script>")
  expect(landing).toContain("A &lt;/script&gt;")

  const quoted = getMultiBoardRunframeHtml({
    board: { ...statuses[0]!, label: "Q\"uote's" },
    boards: statuses,
    mode: "prerouted",
  })
  expect(quoted).toContain('TSCIRCUIT_PACKAGE_NAME = "Q\\"uote\'s"')
})
