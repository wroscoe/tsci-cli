import type { BoardStatus } from "lib/dev/multi-board/board-manifest"

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

const formatSize = (n: number | null) =>
  n === null
    ? "-"
    : n < 1024
      ? `${n} B`
      : n < 1024 * 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1024 / 1024).toFixed(1)} MB`

export const getMultiBoardLandingHtml = ({
  boards,
}: { boards: BoardStatus[] }) => {
  const rows = boards
    .map((b) => {
      const id = encodeURIComponent(b.id)
      const badge = b.hasPrerouted
        ? '<span class="px-2 py-0.5 rounded bg-green-100 text-green-800 text-xs">prerouted</span>'
        : '<span class="px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs">missing</span>'
      const mtime = b.mtimeMs ? new Date(b.mtimeMs).toLocaleString() : "-"
      return `<tr class="border-t">
        <td class="p-2">${escapeHtml(b.label)}</td>
        <td class="p-2 font-mono text-sm">${escapeHtml(b.id)}</td>
        <td class="p-2">${badge}</td>
        <td class="p-2 text-sm">${escapeHtml(mtime)}</td>
        <td class="p-2 text-sm">${formatSize(b.sizeBytes)}</td>
        <td class="p-2 text-sm"><a class="text-blue-600 underline" href="/b/${id}">PCB</a> | <a class="text-blue-600 underline" href="/b/${id}#tab=schematic">Schematic</a></td>
      </tr>`
    })
    .join("\n")

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" type="image/png" href="https://github.com/tscircuit.png">
    <title>tscircuit boards</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="p-6">
    <h1 class="text-xl font-semibold mb-4">Boards (${boards.length})</h1>
    <table class="w-full text-left">
      <thead><tr class="text-sm text-gray-600">
        <th class="p-2">Label</th><th class="p-2">ID</th><th class="p-2">Status</th>
        <th class="p-2">Modified</th><th class="p-2">Size</th><th class="p-2">Open</th>
      </tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </body>
</html>`
}
