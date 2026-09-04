#!/usr/bin/env node
/**
 * Страж общего UI (см. docs/TOOL_UI.md, раздел «Автопроверка»).
 *
 * Две проверки:
 *  1. Страницы инструментов (src/app/(main)/*\/page.tsx, которые импортируют
 *     из components/tool) не содержат разметку и логику, которым место в общем
 *     слое: скрытый input файлов, перенос и вставка, сцена, пакетный грид,
 *     дропзона, плавающие слои, галерея, «выбрано N», сохранение исходника…
 *  2. Каждый экспортированный компонент и хук общего слоя описан в
 *     docs/TOOL_UI.md — новая часть UI не может появиться без записи в карте.
 *
 * Запуск: `npm run check:ui` (входит в `npm run lint`). Как хук Claude Code
 * (`--hook`) читает JSON события со stdin и проверяет только когда правили
 * относящийся к UI файл; при нарушениях завершается кодом 2, чтобы ассистент
 * увидел и исправил.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { dirname, join, relative, basename } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const DOC = join(ROOT, "docs/TOOL_UI.md")
const PAGES_DIR = join(ROOT, "src/app/(main)")

/** Файлы, чьи экспорты образуют «список компонентов» и обязаны быть в документе. */
const CATALOG_SOURCES = [
  "src/components/tool",
  "src/components/ui",
  "src/components/page-header.tsx",
  "src/components/page-loader.tsx",
  "src/lib/use-attachments.ts",
  "src/lib/use-batch-selection.ts",
  "src/lib/tool-jobs.ts",
]

/** Что на странице инструмента запрещено — и куда это должно уйти. */
const FORBIDDEN = [
  [/<input[^>]*type="file"/, "скрытый <input type=\"file\"> рендерит ToolShell — состояние файлов даёт useAttachments"],
  [/useState<AttachedRender\[\]>/, "состояние приложенных файлов — useAttachments, не useState на странице"],
  [/addEventListener\("paste"/, "вставка из буфера — внутри useAttachments"],
  [/onDragEnter=|onDrop=/, "перенос файлов на страницу — ToolShell + useAttachments (dropProps)"],
  [/URL\.createObjectURL/, "превью файлов — useAttachments; блобы результата — useBlobUrl (tool-card)"],
  [/className="[^"]*\bstage\b/, "сцена и её бейджи — компонент Stage (components/tool/stage.tsx)"],
  [/batch-tile|Пакетн[а-я]+ [а-я]+<\/span>/, "пакетный грид — компонент BatchGrid (components/tool/stage.tsx)"],
  [/\bdropzone\b/, "пустой экран — компонент ToolDropzone"],
  [/presence-(rise|slide|fade)/, "плавающие слои — ComposerDock / ToolAside / ToolShell (tool-shell.tsx)"],
  [/columns-1 gap-4/, "галерея-масонри — компонент ToolGallery"],
  [/<aside\b/, "закреплённая правая панель — компонент ToolAside"],
  [/fixed inset-x-3/, "полоса композера внизу — компонент ComposerDock"],
  [/page-shell|page-content-wide/, "каркас страницы — компонент ToolShell"],
  [/useMounted\(|useBlobGc\(/, "скелет до гидрации и GC блобов — внутри ToolShell"],
  [/\["выбран", "выбрано"/, "подпись «выбрано N …» — useBatchSelection.selectionLabel"],
  [/putBlob\(sourceKey|putBlob\(thumbSourceKey/, "сохранение исходника и миниатюры — saveSourceFile (lib/tool-jobs)"],
  [/\[\.\.\.metas\]\.reverse\(\)/, "очередь пачки — runGalleryQueue (lib/tool-jobs)"],
  [/activeProject \?\? createProject\(\)/, "проект для новой записи — ensureActiveProject (stores/project-store)"],
  [/replace\(\/\\\.\[\^\.\]\+\$\//, "имя файла без расширения — fileBaseName (lib/utils)"],
]

const RELEVANT = /(src\/app\/\(main\)\/|src\/components\/|src\/lib\/(use-|tool-jobs)|src\/styles\/|docs\/TOOL_UI\.md)/

function listFiles(dir, ext) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ext.some((e) => entry.name.endsWith(e)))
    .map((entry) => join(dir, entry.name))
}

function catalogFiles() {
  const files = []
  for (const source of CATALOG_SOURCES) {
    const full = join(ROOT, source)
    if (!existsSync(full)) continue
    if (source.endsWith(".ts") || source.endsWith(".tsx")) files.push(full)
    else files.push(...listFiles(full, [".tsx", ".ts"]))
  }
  return files
}

/** Экспортированные компоненты (с большой буквы) и хуки (use…). */
function exportedNames(file) {
  const text = readFileSync(file, "utf8")
  const names = new Set()
  for (const match of text.matchAll(/^export (?:default )?(?:async )?function ([A-Za-z_][A-Za-z0-9_]*)/gm)) {
    names.add(match[1])
  }
  for (const match of text.matchAll(/^export const ([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]+)?=\s*(?:\(|function|memo\(|forwardRef\()/gm)) {
    names.add(match[1])
  }
  return [...names].filter((name) => /^[A-Z]/.test(name) || /^use[A-Z]/.test(name))
}

function toolPages() {
  if (!existsSync(PAGES_DIR)) return []
  const pages = []
  for (const entry of readdirSync(PAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const page = join(PAGES_DIR, entry.name, "page.tsx")
    if (!existsSync(page)) continue
    const text = readFileSync(page, "utf8")
    if (text.includes("@/components/tool/")) pages.push({ page, text })
  }
  return pages
}

function run() {
  const problems = []

  // 1. Страницы инструментов не дублируют общий слой.
  const pages = toolPages()
  for (const { page, text } of pages) {
    const lines = text.split("\n")
    for (const [re, hint] of FORBIDDEN) {
      lines.forEach((line, index) => {
        // Строки импортов содержат имена файлов общего слоя («tool-dropzone») — это не нарушение.
        if (/^\s*import\b|\bfrom "/.test(line)) return
        if (re.test(line)) problems.push(`${relative(ROOT, page)}:${index + 1} — ${hint}\n      ${line.trim().slice(0, 120)}`)
      })
    }
  }

  // 2. Каждый компонент и хук общего слоя описан в docs/TOOL_UI.md.
  const doc = existsSync(DOC) ? readFileSync(DOC, "utf8") : ""
  if (!doc) problems.push("docs/TOOL_UI.md не найден — карта общего UI обязательна")
  let catalogued = 0
  for (const file of catalogFiles()) {
    for (const name of exportedNames(file)) {
      catalogued += 1
      const mentioned = new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(doc)
      if (!mentioned) {
        problems.push(
          `docs/TOOL_UI.md не упоминает \`${name}\` из ${relative(ROOT, file)} — добавьте его в карту «где что менять» или в каталог компонентов`
        )
      }
    }
    const base = basename(file)
    if (file.includes("/components/tool/") && !doc.includes(base)) {
      problems.push(`docs/TOOL_UI.md не упоминает файл ${base} (${relative(ROOT, file)}) — каждый файл общего слоя должен быть в каталоге`)
    }
  }

  return { problems, pages: pages.length, catalogued }
}

function main() {
  const hookMode = process.argv.includes("--hook")
  if (hookMode) {
    let payload = ""
    try {
      payload = readFileSync(0, "utf8")
    } catch {
      payload = ""
    }
    let filePath = ""
    try {
      const json = JSON.parse(payload || "{}")
      filePath = json?.tool_input?.file_path ?? json?.tool_response?.filePath ?? ""
    } catch {
      filePath = ""
    }
    // Правили что-то не из UI — молчим и не мешаем.
    if (filePath && !RELEVANT.test(filePath)) process.exit(0)
  }

  const { problems, pages, catalogued } = run()
  if (problems.length === 0) {
    if (!hookMode) console.log(`check:ui — ок: ${pages} страниц инструментов, ${catalogued} компонентов и хуков в docs/TOOL_UI.md`)
    process.exit(0)
  }

  const header = "Общий UI нарушен (docs/TOOL_UI.md, правила):"
  const body = problems.map((item) => `  • ${item}`).join("\n")
  const footer =
    "Исправьте: вынесите разметку в общий компонент/хук или передайте проп, и опишите новое в docs/TOOL_UI.md. Проверка: npm run check:ui"
  process.stderr.write(`${header}\n${body}\n${footer}\n`)
  process.exit(hookMode ? 2 : 1)
}

main()
