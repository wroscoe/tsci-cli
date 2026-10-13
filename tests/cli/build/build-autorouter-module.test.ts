import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { getCliTestFixture } from "../../fixtures/get-cli-test-fixture"

const solverSource = `
export function createAutorouter(srj: any) {
  const listeners: Record<string, Array<(ev: any) => void>> = {}
  const solve = () =>
    srj.connections.map((connection: any) => {
      const [a, b] = connection.pointsToConnect
      return {
        type: "pcb_trace",
        pcb_trace_id: "custom_trace_" + connection.name,
        connection_name: connection.name,
        route: [
          { route_type: "wire", x: a.x, y: a.y, width: 0.15, layer: a.layer ?? "top" },
          { route_type: "wire", x: b.x, y: b.y, width: 0.15, layer: b.layer ?? "top" },
        ],
      }
    })
  return {
    input: srj,
    isRouting: false,
    start() {
      const traces = solve()
      queueMicrotask(() => {
        for (const cb of listeners.complete ?? []) cb({ type: "complete", traces })
      })
    },
    stop() {},
    on(event: string, cb: (ev: any) => void) {
      ;(listeners[event] ??= []).push(cb)
    },
    solveSync: solve,
  }
}
`

const board = `export default ({ autorouter }: { autorouter?: string }) => (
  <board width="20mm" height="10mm" autorouter={autorouter as any}>
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-5} pcbY={2} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={5} pcbY={2} />
    <resistor name="R3" resistance="1k" footprint="0402" pcbX={-5} pcbY={-2} />
    <resistor name="R4" resistance="1k" footprint="0402" pcbX={5} pcbY={-2} />
    <trace from="R1.2" to="R2.1" />
    <trace from="R3.2" to="R4.1" />
  </board>
)
`

const setup = async (solver: string) => {
  const fixture = await getCliTestFixture()
  const { tmpDir } = fixture
  await fs.writeFile(path.join(tmpDir, "package.json"), "{}")
  await fs.mkdir(path.join(tmpDir, "node_modules"))
  await fs.symlink(
    path.resolve("node_modules/react"),
    path.join(tmpDir, "node_modules/react"),
    "dir",
  )
  await fs.writeFile(path.join(tmpDir, "solver.ts"), solver)
  await fs.writeFile(path.join(tmpDir, "board.circuit.tsx"), board)
  return fixture
}

const readCircuitJson = async (tmpDir: string) =>
  JSON.parse(
    await fs.readFile(path.join(tmpDir, "dist/board/circuit.json"), "utf-8"),
  ) as Array<{ type: string; [key: string]: unknown }>

for (const concurrency of [1, 2]) {
  test(`build --autorouter-module routes with custom solver (concurrency ${concurrency})`, async () => {
    const { tmpDir, runCommand } = await setup(solverSource)
    const result = await runCommand(
      `tsci build board.circuit.tsx --autorouter-module ./solver.ts --concurrency ${concurrency}`,
    )
    expect(result.exitCode).toBe(0)
    const circuitJson = await readCircuitJson(tmpDir)
    const traces = circuitJson.filter((e) => e.type === "pcb_trace")
    expect(traces).toHaveLength(2)
    // Proves the fixture solver (not the built-in router) produced the traces
    expect(JSON.stringify(traces)).toContain("custom_trace_")
    expect(circuitJson.filter((e) => e.type.endsWith("_error"))).toHaveLength(0)
  }, 60_000)
}

test("build --autorouter-module works with --autorouter-debug (writes board.meta.json)", async () => {
  const { tmpDir, runCommand } = await setup(solverSource)
  const result = await runCommand(
    "tsci build board.circuit.tsx --autorouter-module ./solver.ts --autorouter-debug",
  )
  expect(result.exitCode).toBe(0)
  const meta = JSON.parse(
    await fs.readFile(
      path.join(tmpDir, "dist/autorouter-debug/board.meta.json"),
      "utf-8",
    ),
  )
  expect(meta.phaseCount).toBeGreaterThan(0)
}, 60_000)

test("build --autorouter-module errors when module lacks createAutorouter", async () => {
  const { runCommand } = await setup("export const nope = 1\n")
  const result = await runCommand(
    "tsci build board.circuit.tsx --autorouter-module ./solver.ts",
  )
  expect(result.exitCode).not.toBe(0)
  expect(result.stdout + result.stderr).toContain(
    'Autorouter module "./solver.ts" must export a createAutorouter',
  )
}, 60_000)
