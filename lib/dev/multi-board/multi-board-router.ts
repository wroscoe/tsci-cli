import * as fs from "node:fs"
import type http from "node:http"
import { getMultiBoardLandingHtml } from "lib/site/get-multi-board-landing-html"
import { getMultiBoardRunframeHtml } from "lib/site/get-multi-board-runframe-html"
import { type ResolvedBoard, resolveBoardStatus } from "./board-manifest"

export const createMultiBoardRouter = ({
  boards,
}: { boards: ResolvedBoard[] }) => {
  const byId = new Map(boards.map((b) => [b.id, b]))

  const notFound = (res: http.ServerResponse) => {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
    res.end("Board not found")
  }

  const safeId = (raw: string): string | undefined => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return undefined
    }
  }

  return async (
    url: URL,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<boolean> => {
    const p = url.pathname

    if (p === "/" || p === "/api/boards.json") {
      const statuses = boards.map(resolveBoardStatus)
      if (p === "/api/boards.json") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        })
        res.end(JSON.stringify(statuses))
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        res.end(getMultiBoardLandingHtml({ boards: statuses }))
      }
      return true
    }

    if (p.startsWith("/api/boards")) {
      notFound(res)
      return true
    }

    const pageMatch = p.match(/^\/b\/([^/]+)\/?$/)
    if (pageMatch) {
      const id = safeId(pageMatch[1]!)
      const board = id !== undefined ? byId.get(id) : undefined
      if (!board) {
        notFound(res)
        return true
      }
      const statuses = boards.map(resolveBoardStatus)
      const status = statuses.find((s) => s.id === board.id)!
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      })
      res.end(
        getMultiBoardRunframeHtml({
          board: status,
          boards: statuses,
          mode: "prerouted",
        }),
      )
      return true
    }

    const jsonMatch = p.match(/^\/boards\/([^/]+)\/circuit\.json$/)
    if (jsonMatch) {
      const id = safeId(jsonMatch[1]!)
      const board = id !== undefined ? byId.get(id) : undefined
      if (!board) {
        notFound(res)
        return true
      }
      let size: number
      try {
        const st = fs.statSync(board.absPreroutedJson)
        if (!st.isFile()) throw new Error("not a file")
        size = st.size
      } catch {
        notFound(res)
        return true
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": size,
      })
      const stream = fs.createReadStream(board.absPreroutedJson)
      stream.on("error", () => res.destroy())
      stream.pipe(res)
      return true
    }

    return false
  }
}
