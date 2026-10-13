import type { BoardStatus } from "lib/dev/multi-board/board-manifest"
import { escapeHtml } from "./get-multi-board-landing-html"
import { loadingStateUi } from "./loadingStateUi"

/** JSON for embedding inside an inline <script>; `<` is escaped. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")

export interface GetMultiBoardRunframeHtmlOptions {
  board: BoardStatus
  boards: BoardStatus[]
  mode: "prerouted"
}

export const getMultiBoardRunframeHtml = ({
  board,
  boards,
  mode,
}: GetMultiBoardRunframeHtmlOptions) => {
  const filePath = `${board.id}/circuit.json`
  const files = [
    {
      filePath,
      fileStaticAssetUrl: `/boards/${encodeURIComponent(board.id)}/circuit.json?v=${board.mtimeMs ?? 0}`,
    },
  ]
  const multiboard = {
    boards: boards.map((b) => ({ id: b.id, label: b.label })),
    currentId: board.id,
    mode,
    mtimeMs: board.mtimeMs,
    sizeBytes: board.sizeBytes,
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="https://github.com/tscircuit.png">
    <title>${escapeHtml(board.label)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body { margin: 0; }
      #tsci-multiboard-bar { height: 40px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 12px; background: #111827; color: #f9fafb; font: 13px system-ui, sans-serif; }
      #tsci-multiboard-bar select, #tsci-multiboard-bar button { font: inherit; }
      #tsci-multiboard-bar a { color: #93c5fd; }
      #root { height: calc(100vh - 40px); }
    </style>
  </head>
  <body>
    <script>
      window.TSCIRCUIT_USE_RUNFRAME_FOR_CLI = false;
      window.TSCIRCUIT_RUNFRAME_STATIC_FILE_LIST = ${scriptJson(files)};
      window.TSCIRCUIT_DEFAULT_MAIN_COMPONENT_PATH = ${scriptJson(filePath)};
      window.TSCIRCUIT_PACKAGE_NAME = ${scriptJson(board.label)};
      window.TSCI_MULTIBOARD = ${scriptJson(multiboard)};
    </script>
    <script src="https://cdn.tailwindcss.com"></script>
    <div id="tsci-multiboard-bar"></div>
    <div id="root">${loadingStateUi}</div>
    <script>
      globalThis.process = { env: { NODE_ENV: "production" } }
    </script>
    <script>
    (function () {
      var mb = window.TSCI_MULTIBOARD;
      var bar = document.getElementById("tsci-multiboard-bar");
      var ids = mb.boards.map(function (b) { return b.id; });
      var idx = ids.indexOf(mb.currentId);
      function go(id) {
        var m = /(?:^#|&)(tab=[^&]*)/.exec(location.hash);
        location.href = "/b/" + encodeURIComponent(id) + (m ? "#" + m[1] : "");
      }
      var home = document.createElement("a");
      home.href = "/"; home.textContent = "All boards";
      var prev = document.createElement("button");
      prev.textContent = "\\u2039 Prev";
      prev.disabled = idx <= 0;
      prev.onclick = function () { go(ids[idx - 1]); };
      var sel = document.createElement("select");
      mb.boards.forEach(function (b) {
        var o = document.createElement("option");
        o.value = b.id; o.textContent = b.label + " (" + b.id + ")";
        if (b.id === mb.currentId) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = function () { go(sel.value); };
      var next = document.createElement("button");
      next.textContent = "Next \\u203A";
      next.disabled = idx < 0 || idx >= ids.length - 1;
      next.onclick = function () { go(ids[idx + 1]); };
      var reroute = document.createElement("button");
      reroute.textContent = "Reroute";
      reroute.disabled = true;
      reroute.title = "coming in phase 2";
      [home, prev, sel, next, reroute].forEach(function (el) { bar.appendChild(el); });
      var pending = null;
      setInterval(function () {
        fetch("/api/boards.json", { cache: "no-store" })
          .then(function (r) { return r.json(); })
          .then(function (list) {
            var cur = list.find(function (b) { return b.id === mb.currentId; });
            if (!cur) return;
            var sig = cur.mtimeMs + ":" + cur.sizeBytes;
            if (sig === mb.mtimeMs + ":" + mb.sizeBytes) { pending = null; return; }
            if (pending === sig) location.reload();
            else pending = sig;
          })
          .catch(function () {});
      }, 2000);
    })();
    </script>
    <script type="module" src="/standalone.min.js"></script>
  </body>
</html>`
}
