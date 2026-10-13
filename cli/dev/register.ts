import * as fs from "node:fs"
import * as net from "node:net"
import * as path from "node:path"
import type { Command } from "commander"
import kleur from "kleur"
import { DevServer } from "lib/dev/DevServer"
import { loadBoardManifest } from "lib/dev/multi-board/board-manifest"
import { getVersion } from "lib/getVersion"
import { parseAutorouterPhaseName } from "lib/shared/autorouter-diagnostics"
import { ZodError } from "zod"
import { resolveDevTarget } from "./resolve-dev-target"

const isPortAvailable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port)
  })
}

const warnIfTsconfigMissingTscircuitType = (projectDir: string) => {
  const tsconfigPath = path.join(projectDir, "tsconfig.json")
  if (!fs.existsSync(tsconfigPath)) {
    return
  }

  try {
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"))
    const types = tsconfig?.compilerOptions?.types
    if (!Array.isArray(types) || !types.includes("tscircuit")) {
      console.warn(
        kleur.yellow(
          'Warning: "tscircuit" is missing from tsconfig.json compilerOptions.types. Add it (e.g. "types": ["tscircuit"]) to ensure CLI-provided types work correctly.',
        ),
      )
    }
  } catch {
    // ignore JSON parse errors here; other parts of the CLI will surface them if needed
  }
}

export const registerDev = (program: Command) => {
  program
    .command("dev")
    .description("Start development server for a package")
    .argument("[file]", "Path to the package file or directory")
    .option("-p, --port <number>", "Port to run server on", "3020")
    .option(
      "--boards <spec>",
      "Serve multiple prerouted boards from a manifest JSON or a glob of board directories (prerouted path is resolved at startup)",
    )
    .option("--kicad-pcm", "Enable KiCad PCM proxy server at /pcm/*")
    .option("--jscdn-dir <path>", "Serve prepared JS CDN packages at /jscdn/*")
    .option(
      "--autorouter-debug",
      "Log autorouting diagnostics emitted by the dev runframe",
    )
    .option(
      "--autorouter-phase <name>",
      "Log autorouting diagnostics through the named phase",
    )
    .option(
      "--autorouter-timeout <duration>",
      "Accepted for parity with build; dev autorouting timeouts are handled in the browser runframe",
    )
    .option(
      "--autorouter-debug-dir <path>",
      "Accepted for parity with build; dev debug artifacts are handled in the browser runframe",
    )
    .option(
      "--autorouter-dump-srj [mode]",
      "Accepted for parity with build; dev SRJ downloads are handled in the browser runframe",
    )
    .action(
      async (
        file: string,
        options: {
          port: string
          boards?: string
          kicadPcm?: boolean
          jscdnDir?: string
          autorouterDebug?: boolean
          autorouterPhase?: string
          autorouterTimeout?: string
          autorouterDebugDir?: string
          autorouterDumpSrj?: string | boolean
        },
      ) => {
        let port = parseInt(options.port)
        const startTime = Date.now()

        while (!(await isPortAvailable(port))) {
          console.log(
            kleur.gray(`Port ${port} is in use, trying port ${port + 1}...`),
          )
          port += 1
        }

        if (options.boards) {
          let boards: ReturnType<typeof loadBoardManifest>
          try {
            boards = loadBoardManifest(options.boards, process.cwd())
          } catch (error) {
            const msg =
              error instanceof ZodError
                ? error.issues
                    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
                    .join("\n  ")
                : error instanceof Error
                  ? error.message
                  : String(error)
            console.error(kleur.red(`Error: ${msg}`))
            return
          }
          if (
            file ||
            options.kicadPcm ||
            options.autorouterDebug ||
            options.autorouterPhase ||
            options.autorouterTimeout ||
            options.autorouterDebugDir ||
            options.autorouterDumpSrj
          ) {
            console.warn(
              kleur.yellow(
                "Warning: --boards ignores the file argument, --kicad-pcm and --autorouter-* flags.",
              ),
            )
          }
          const first = boards[0]!
          const server = new DevServer({
            port,
            componentFilePath: first.absEntry ?? first.absPreroutedJson,
            projectDir: first.absDir,
            boards,
          })
          await server.start()
          console.log(
            `\n  ${kleur.green(`@tscircuit/cli@${getVersion()}`)} ${kleur.gray("ready in")} ${kleur.white(`${Math.round(Date.now() - startTime)}ms`)}`,
          )
          console.log(
            `\n  ${kleur.bold("➜ Local:")}   ${kleur.underline(kleur.cyan(`http://localhost:${port}/`))}`,
          )
          for (const b of boards) {
            console.log(
              `    ${kleur.gray(b.id.padEnd(20))} ${kleur.underline(kleur.cyan(`http://localhost:${port}/b/${encodeURIComponent(b.id)}`))}`,
            )
          }
          console.log()
          return
        }

        const target = await resolveDevTarget(file)
        if (!target) return

        const { absolutePath, projectDir } = target
        const autorouterPhase =
          options.autorouterPhase !== undefined
            ? parseAutorouterPhaseName(options.autorouterPhase)
            : undefined

        warnIfTsconfigMissingTscircuitType(projectDir)

        const server = new DevServer({
          port,
          componentFilePath: absolutePath,
          projectDir,
          kicadPcm: options.kicadPcm,
          jscdnDir: options.jscdnDir,
          autorouterDebug:
            options.autorouterDebug || autorouterPhase !== undefined,
          autorouterPhase,
        })

        await server.start()

        const timeToStart = Date.now() - startTime

        console.log(
          `\n\n  ${kleur.green(`@tscircuit/cli@${getVersion()}`)} ${kleur.gray("ready in")} ${kleur.white(`${Math.round(timeToStart)}ms`)}`,
        )
        console.log(
          `\n  ${kleur.bold("➜ Local:")}   ${kleur.underline(kleur.cyan(`http://localhost:${port}`))}${server.componentFilePath ? kleur.underline(kleur.cyan(`/#file=${encodeURIComponent(path.relative(process.cwd(), server.componentFilePath).replaceAll("\\", "/"))}`)) : ""}\n\n`,
        )
        console.log(
          kleur.gray(
            `Watching ${kleur.underline(server.projectDir.split("/").slice(-2).join("/")!)} for changes...`,
          ),
        )

        if (options.kicadPcm) {
          console.log(
            `\n  ${kleur.bold("➜ Auto-updating KiCad PCM Server:")} ${kleur.underline(kleur.cyan(`http://localhost:${port}/pcm/repository.json`))}\n`,
          )
        }

        if (
          options.autorouterTimeout ||
          options.autorouterDebugDir ||
          options.autorouterDumpSrj ||
          autorouterPhase
        ) {
          console.log(
            kleur.gray(
              "Autorouter timeout/debug artifact flags are fully supported by `tsci build`; `tsci dev` currently logs autorouting events emitted by runframe.",
            ),
          )
        }
      },
    )
}
