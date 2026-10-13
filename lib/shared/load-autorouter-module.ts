import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { AutorouterDefinition } from "@tscircuit/props"

type CreateAutorouter = AutorouterDefinition["createAutorouter"]

const isPathSpec = (spec: string) =>
  path.isAbsolute(spec) || spec.startsWith("./") || spec.startsWith("../")

const resolveAutorouterModuleUrl = (spec: string, projectDir: string) => {
  if (isPathSpec(spec)) {
    return pathToFileURL(path.resolve(projectDir, spec)).href
  }
  const resolved = createRequire(path.join(projectDir, "noop.js")).resolve(spec)
  return pathToFileURL(resolved).href
}

/**
 * Load a user-supplied autorouter module and wrap it as an
 * AutorouterDefinition for `platformConfig.autorouterMap`.
 *
 * The module must export `createAutorouter(srj, opts?)`, or a default export
 * that is such a function or an object with a `createAutorouter` function.
 */
export const loadAutorouterModule = async (
  spec: string,
  projectDir: string,
): Promise<AutorouterDefinition> => {
  let mod: any
  try {
    mod = await import(resolveAutorouterModuleUrl(spec, projectDir))
  } catch (error) {
    throw new Error(
      `Failed to load autorouter module "${spec}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const candidates = [mod?.createAutorouter, mod?.default]
  let createAutorouter: CreateAutorouter | undefined
  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      createAutorouter = candidate
      break
    }
    if (typeof candidate?.createAutorouter === "function") {
      createAutorouter = candidate.createAutorouter.bind(candidate)
      break
    }
  }

  if (!createAutorouter) {
    throw new Error(
      `Autorouter module "${spec}" must export a createAutorouter(simpleRouteJson, opts?) function, or a default export that is a function or has a createAutorouter method`,
    )
  }

  return { createAutorouter }
}

export const withAutorouterModule = async <T extends object | undefined>(
  platformConfig: T,
  options: {
    autorouterModule?: string
    autorouterModuleName?: string
    projectDir: string
  },
) => {
  if (!options.autorouterModule) return platformConfig
  const { mergePlatformConfigs } = await import("./platform-config-utils")
  const definition = await loadAutorouterModule(
    options.autorouterModule,
    options.projectDir,
  )
  return mergePlatformConfigs(platformConfig as any, {
    autorouterMap: { [options.autorouterModuleName ?? "custom"]: definition },
  })
}
