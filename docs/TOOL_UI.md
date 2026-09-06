# Общий UI инструментов

Как собран экран инструмента Dizzit AI и **где править, чтобы изменилось везде**.
Экраны «Редактор рендера», «Ракурсы и детали», «Перенос стиля», «Фото → 3D» и
«Генерация материала» не содержат собственной разметки композера, панелей,
сцены или приёма файлов — они собирают экран из общих частей и добавляют
только своё: тексты, набор опций, движок и специфические секции.

Правило одно: **у каждой повторяющейся части экрана ровно одно место в коде.**
Страница инструмента — это конфигурация (тексты, опции) плюс логика самого
инструмента. Если хочется скопировать разметку из соседней страницы —
значит, ей место в общем компоненте, а на странице — проп.

---

## Карта «хочу поменять — где править»

| Что меняется на всех экранах | Файл | Где именно |
| --- | --- | --- |
| Композер внизу: строка комментария, главная кнопка, шестерёнка, чип приложенных файлов | `src/components/tool/tool-composer.tsx` | `ToolComposer`, блок «Сам композер» |
| Секция **«выбран 1 рендер / выбрано 3 интерьера»** слева от комментария | `tool-composer.tsx` — разметка; `src/lib/use-batch-selection.ts` — текст | проп `selectionLabel`; поле `selectionLabel` хука |
| Панель настроек над композером («выпадающие настройки»): секция файлов, индикатор качества, выбор-сегмент, обещание продукта внизу | `tool-composer.tsx` | блок «Панель настроек», `SectionLabel` |
| Замечание над строкой ввода («Выберите настройки…»), теги областей, «волна» подсветки по контролам | `tool-composer.tsx` | пропсы `notice`, `regionTags`, `attentionKey` |
| Секция, пристыкованная над композером (материалы стиля с галочками) | `tool-composer.tsx` — обёртка; `style-dock.tsx` — содержимое | проп `dock` |
| Тумблер «Заселить сцену», пакетные функции (качество, фильтр, время) | `src/components/tool/batch-tools.tsx` | `PopulateToggle`, `BatchToolsPanel` |
| Правая панель-галерея пачки: заголовок «рендеры · 3 из 10», «Выбрать», плитки, «Добавить», «Очистить», «Редактировать все» | `src/components/tool/render-tray.tsx` | `RenderTray`, `TrayThumb` |
| Полоска миниатюр под сценой на узких экранах | `render-tray.tsx` | `RenderStrip` |
| Закреплённая правая панель как поверхность (ширина, тень, рамка, анимация выезда) | `src/components/tool/tool-shell.tsx` | `ToolAside` |
| Сцена: рендер во весь экран, бейджи имени/размера и «2 / 7», стрелки | `src/components/tool/stage.tsx` | `Stage` |
| Пакетный грид с заголовком «Пакетное …» и кнопкой «К просмотру» | `stage.tsx` | `BatchGrid` |
| Пустой экран — дропзона с пунктиром, приглашением, заголовком и подписью | `src/components/tool/tool-dropzone.tsx` | `ToolDropzone` |
| Слой «Отпустите, чтобы приложить…», скрытый `<input type="file">`, отступы под композер и панель, скелет до гидрации | `tool-shell.tsx` | `ToolShell` |
| Положение композера внизу (отступ под сайдбар и панель, анимация появления) | `tool-shell.tsx` | `ComposerDock` |
| Галерея-масонри результатов (колонки) | `tool-shell.tsx` | `ToolGallery` |
| Карточка результата: «до/после», скачать, удалить, статусы | `src/components/tool/tool-card.tsx` | `ToolCard` (у сетов кадров — своя `view-set-card.tsx`) |
| Правила приёма файлов: форматы, лимит, предупреждения, перенос, вставка из буфера, замена вместо добавления | `src/lib/use-attachments.ts` | `useAttachments`; константы форматов и лимитов — `src/lib/enhance-engine.ts` |
| Рабочий набор: режим «Выбрать», «Выбрать все», стрелки и Escape, «Редактировать все», что уходит в обработку | `src/lib/use-batch-selection.ts` | `useBatchSelection` |
| Сохранение исходника в IndexedDB, очередь пачки (карточки сразу, обработка по одной) | `src/lib/tool-jobs.ts` | `saveSourceFile`, `runGalleryQueue` |
| Куда уходит генерация картинок: провайдер, пропорции, уменьшение референса, предпросмотр без ключа, подпись «предпросмотр без ключа» на карточке | `src/lib/image-generation.ts` — клиент; `src/app/api/images/route.ts` + `src/server/providers.ts` (выбор), `apimodels.ts`, `laozhang.ts` — сервер (ключи) | `requestImage`, `withImageProvider`, `prepareReference`, `previewCaption`; промпты — в движке инструмента (`build*Prompt`) |
| В какой проект класть новые записи | `src/stores/project-store.ts` | `ensureActiveProject`, `useActiveProject` |
| Внешний вид всего перечисленного (рецепты CSS) | `src/styles/ds/surfaces.css` | `.stage-*`, `.batch-tile`, `.tray-*`, `.dropzone`, `.popover`, `.presence-*`, `.composer-notice`, `.rg-tag`, `.style-dock` |

Пример. Нужно убрать индикатор качества исходников из панели настроек на всех
экранах — это один блок в `tool-composer.tsx` (комментарий «Индикатор качества
файлов»). Нужно, чтобы стрелки сцены были всегда видны — одно правило
`.stage-nav` в `surfaces.css`. Нужно поменять формулировку «выбрано N» —
одно место в `use-batch-selection.ts`.

---

## Анатомия экрана

```
ToolShell                          приём файлов на всю страницу, отступы, скелет
├── page-content-wide
│   ├── ToolDropzone               пустой экран: visual инструмента + заголовок
│   │   или
│   ├── Stage / BatchGrid          пачка приложена: сцена или грид набора
│   │   └── RenderStrip            (< lg) полоска миниатюр под сценой
│   │   или
│   └── ToolGallery                галерея результатов
│       └── ToolCard | ViewSetCard
└── layers
    ├── ComposerDock               плавающая полоса внизу
    │   └── ToolComposer           композер + панель настроек + dock
    └── ToolAside (×1…2)           закреплённые панели справа (≥ lg / ≥ xl)
        ├── RenderTray             панель-галерея пачки
        └── StylePicker            (перенос стиля) список стилей
```

Данные текут так:

```
useAttachments ──► intake ──► ToolShell (input, перенос, вставка)
                     │        ToolComposer (чип, сетка файлов)
                     ▼
useBatchSelection ─► batch ──► Stage / BatchGrid / RenderTray / RenderStrip
                              ToolComposer.selectionLabel
                              submit(): batch.takeWorkingSet() → файлы в обработку
```

---

## Хуки

### `useAttachments(options)` — `src/lib/use-attachments.ts`

Приложенные файлы до отправки. Три пути приёма (диалог, перенос, вставка из
буфера) ведут в один `attachFiles` с одними правилами: PNG/JPG/WEBP до 32 МБ,
не больше пачки, лишнее — с предупреждением. Превью — object URL, который хук
сам отзывает, когда файл уходит из пачки.

| Опция | Смысл |
| --- | --- |
| `maxFiles` | лимит пачки; по умолчанию `MAX_BATCH` (10) |
| `replace` | новые файлы заменяют приложенные («Фото → 3D»: одно фото на модель) |
| `onDetach(urls)` | файлы ушли из пачки (убрали, очистили, отправили) — страница подчищает своё по `previewUrl` (области правки у редактора рендера) |

Возвращает `AttachmentIntake`: `attachments`, `attachFiles`, `removeAttachment`,
`clearAttachments`, `detach(urls)`, `pickFiles`, а также всё, что нужно
`ToolShell` для скрытого input и переноса (`inputRef`, `onInputChange`,
`accept`, `multiple`, `dragOver`, `dropProps`). Хук ничего не рендерит.

### `useBatchSelection(intake, options)` — `src/lib/use-batch-selection.ts`

Рабочий набор пачки — что на сцене и что уйдёт в обработку. Обычный режим:
клик по плитке — один рендер на сцену, он же в обработку. Режим «Выбрать» (как
в «Фото» iOS): клики набирают несколько, обработка ко всем сразу. Стрелки
листают сцену, Escape выходит из режима выбора (если каретка не в поле ввода).

| Опция | Смысл |
| --- | --- |
| `noun` | формы слова для подписи: `["рендер", "рендера", "рендеров"]` |
| `onEditAll` / `onLeaveBatch` | что ещё сделать при входе/выходе из пакетного режима (редактор рендера открывает и закрывает настройки) |

Возвращает `BatchSelection`: `current`, `focusIndex`, `pickedItems`,
`workingSet`, `showBatchGrid`, `selectionLabel`, обработчики
(`selectAttachment`, `togglePicking`, `editAll`, `leaveBatch`, `pickAll`,
`selectPrev`/`selectNext`, `removeAttachment`, `clearAttachments`),
`takeWorkingSet()` — забирает набор в обработку и сбрасывает выбор, и
`trayProps` — пропсы `RenderTray`/`RenderStrip` одним объектом:
`<RenderTray {...batch.trayProps} />`.

Набор ведётся по `previewUrl`: он уникален и переживает удаление соседей.
Инструменты без просмотра пачки на сцене («Материалы», «Фото → 3D») этот хук
не используют — им хватает `useAttachments`.

### Помощники

- `saveSourceFile(file)` (`src/lib/tool-jobs.ts`) — исходник и миниатюра в
  IndexedDB под новым id; возвращает `{ id, width, height }`.
- `runGalleryQueue(metas, add, run)` — карточки появляются все сразу,
  обработка по одной; порядок галереи совпадает с порядком выбора файлов.
- `ensureActiveProject()` (`src/stores/project-store.ts`) — активный проект
  или новый «Проект N»; для колбэков вне рендера. В рендере — `useActiveProject()`.
- `fileBaseName(name, fallback)` (`src/lib/utils.ts`) — имя без расширения для
  скачивания.
- `requestImage(...)`, `withImageProvider(remote, preview)`,
  `prepareReference(blob)` (`src/lib/image-generation.ts`) — один вход к
  провайдеру картинок для всех движков; без ключа — локальный предпросмотр,
  помеченный `engine: "preview"`. `previewCaption(item)` — хвост подписи
  карточки для такого результата (`ToolCard`, `ViewSetCard`).
- `mapWithConcurrency(items, limit, run)` (`src/lib/utils.ts`) — несколько
  запросов к провайдеру разом с потолком (кадры сета в «Ракурсах»).

---

## Компоненты

### `ToolShell` — `src/components/tool/tool-shell.tsx`

Каркас экрана. Внутри: скелет до гидрации сторов (`useMounted`), GC хранилища
блобов (`useBlobGc`), скрытый `<input type="file">`, перенос файлов на всю
страницу со слоем «Отпустите…», отступ снизу под композер и справа под панели.

| Проп | Смысл |
| --- | --- |
| `intake` | результат `useAttachments` |
| `dropLabel` | подпись слоя переноса: «Отпустите, чтобы приложить рендеры» |
| `composerOpen` | внизу есть композер — контенту нужен отступ |
| `trayOpen`, `trayMargin` | справа открыта панель; класс отступа (`lg:mr-[296px]`, у переноса стиля с двумя панелями — `lg:mr-[296px] xl:mr-[588px]`) |
| `layers` | плавающие слои: `ComposerDock`, `ToolAside` |
| `children` | содержимое экрана |

### `ComposerDock`, `ToolAside`, `ToolGallery` — там же

- `ComposerDock` — полоса внизу, в которой живёт `ToolComposer`. С `presence`
  (результат `usePresence`) появляется и уходит анимацией, без него есть всегда
  («Материалы»). `trayOpen` + `trayRight` двигают правый край при открытой панели.
- `ToolAside` — закреплённая правая панель как поверхность: зеркало сайдбара.
  По умолчанию позиция панели пачки (`right-4 w-[264px] lg:flex`); панель
  стилей передаёт `className="right-[292px] w-[280px] xl:flex"`.
- `ToolGallery` — колонки масонри для карточек.

### `ToolComposer` — `src/components/tool/tool-composer.tsx`

Композер с панелью настроек. Тексты — `ToolComposerLabels` (заголовки секций,
плейсхолдер, подпись кнопки, формы слова пачки), опции — `ToolOption<T>[]`.
Ключевые режимы:

- `selectionLabel` задан — **режим выбора**: пачкой управляет панель-галерея, а
  композер показывает «выбрано N» и не рисует чип и секцию файлов.
- `tools` задан — панель настроек показывает **только** его (пакетные функции).
- `extras` — дополнительные секции обычной панели (тумблер заселения).
- `dock` — постоянная секция над композером (материалы стиля).
- `regionTags`, `submitBlockedReason`, `placeholder`, `notice`, `attentionKey` —
  точечная правка и подсказки.

### `RenderTray`, `RenderStrip` — `src/components/tool/render-tray.tsx`

Панель-галерея пачки и её узкая версия. Пропсы приходят из
`batch.trayProps`; сверх них — `title` («интерьеры») и `editLabel`
(«Перенести», «Построить»).

### `Stage`, `BatchGrid` — `src/components/tool/stage.tsx`

- `Stage` — рендер во весь экран с бейджами и стрелками. `overlay` (холст
  точечной правки) переключает раскладку: картинка ложится в бокс ровно по
  кадру, размер считается по пропорции. `itemLabel` — для подписей стрелок,
  `className` — размер сцены (`aspect-[4/3] w-full` у переноса стиля).
- `BatchGrid` — грид рабочего набора с заголовком и «К просмотру»;
  `compact` — для узкой колонки переноса стиля.

### `ToolDropzone` — `src/components/tool/tool-dropzone.tsx`

Пустой экран: кнопка-дропзона с SVG-пунктиром, внутри `visual`
(приглашение инструмента: `RenderReveal`, `StyleSwap`, `ViewsInvite`,
`FurnitureMorph`), заголовок, описание и подпись под зоной. `armed` —
файл уже приложен (фото → 3D). `className` — ширина и поля кнопки.

### `ToolCard`, `ViewSetCard` — карточки результата

`ToolCard` общая: миниатюры из IndexedDB, «до/после» по удержанию, скачать,
удалить, повтор при ошибке. У «Ракурсов» своя `ViewSetCard` — контактный лист
из кадров сета.

### Каталог: все файлы общего слоя

Проверка `npm run check:ui` требует, чтобы **каждый** файл `src/components/tool/`
и каждый экспортированный компонент или хук были в этом документе. Новый файл —
новая строка здесь.

| Файл | Экспорт | Что это |
| --- | --- | --- |
| `tool-shell.tsx` | `ToolShell`, `ComposerDock`, `ToolAside`, `ToolGallery` | каркас экрана и плавающие слои |
| `tool-composer.tsx` | `ToolComposer` | композер с панелью настроек |
| `render-tray.tsx` | `RenderTray`, `RenderStrip` | панель-галерея пачки и полоска миниатюр |
| `stage.tsx` | `Stage`, `BatchGrid` | сцена и пакетный грид |
| `tool-dropzone.tsx` | `ToolDropzone` | пустой экран-дропзона |
| `tool-card.tsx` | `ToolCard`, `useBlobUrl` | карточка результата; хук «блоб из IndexedDB → object URL» |
| `view-set-card.tsx` | `ViewSetCard` | карточка сета кадров («Ракурсы») |
| `batch-tools.tsx` | `BatchToolsPanel`, `PopulateToggle` | пакетные функции и тумблер «Заселить сцену» |
| `region-editor.tsx` | `RegionEditor` | холст точечной правки поверх сцены (кисть, обводка, рамка) |
| `style-dock.tsx` | `StyleDock` | материалы выбранного стиля с галочками — секция над композером |
| `style-picker.tsx` | `StylePicker` | список стилей рядом со сценой с окошком-превью |
| `style-scenes.tsx` | `StyleScene` | нарисованная комната в заданном стиле (превью стиля, приглашение) |
| `style-swap.tsx` | `StyleSwap` | приглашение «Переноса стиля»: комната, в которой меняется стиль |
| `material-swatch.tsx` | `MaterialSwatch` | плашка материала (дерево, камень, ткань…) для стилей |
| `material-preview-grid.tsx` | `MaterialPreviewGrid` | пустой экран «Материалов»: сетка заготовок |
| `render-reveal.tsx` | `RenderReveal` | приглашение «Редактора рендера»: живое «до/после» |
| `views-invite.tsx` | `ViewsInvite` | приглашение «Ракурсов»: общий план и кадры из него |
| `room-sketch.tsx` | `RoomSketch` | эскиз комнаты (SVG) для приглашений |
| `furniture-morph.tsx` | `FurnitureMorph` | каркасы мебели, перетекающие друг в друга («Фото → 3D») |

Общие примитивы вне инструментов (`src/components/ui/` и рядом) — те же
правила, один компонент на повторяющуюся часть:

| Файл | Экспорт | Что это |
| --- | --- | --- |
| `ui/panel.tsx` | `Panel`, `Card`, `SectionTitle` | поверхность контента, карточка внутри неё, заголовок блока |
| `ui/field.tsx` | `Field` | подпись + поле с привязанным id |
| `ui/switch.tsx` | `Switch` | тумблер вкл/выкл |
| `ui/empty-state.tsx` | `EmptyState` | пустой экран раздела с одним действием |
| `page-header.tsx` | `PageHeader` | шапка обычной страницы (настройки) |
| `page-loader.tsx` | `PageLoader` | скелет до гидрации сторов |

Хуки общего слоя: `useAttachments`, `useBatchSelection` (`src/lib/`), помощники
`saveSourceFile`, `runGalleryQueue` (`src/lib/tool-jobs.ts`).

---

## Что у инструментов своё

| | Редактор рендера | Ракурсы | Перенос стиля | Материалы | Фото → 3D |
| --- | --- | --- | --- | --- | --- |
| `ToolShell` + `ComposerDock` + `ToolComposer` | ✓ | ✓ | ✓ | ✓ (композер всегда) | ✓ (`maxFiles=1`) |
| `useAttachments` | ✓ | ✓ | ✓ | ✓ | ✓ (`replace`) |
| `useBatchSelection`, `RenderTray`/`RenderStrip`, `ToolAside` | ✓ | ✓ | ✓ (+ панель стилей) | — | — |
| `Stage` | ✓ с `overlay` (RegionEditor) | ✓ | ✓ `aspect-[4/3]` | — | — (своя `ModelStage`) |
| `BatchGrid` | ✓ | ✓ | ✓ `compact` | — | — |
| `ToolDropzone` | ✓ RenderReveal | ✓ ViewsInvite | ✓ StyleSwap | — (MaterialPreviewGrid) | ✓ FurnitureMorph, `armed` |
| `ToolGallery` + карточка | ✓ ToolCard | ✓ ViewSetCard | ✓ ToolCard | ✓ ToolCard | — (сцена + лента) |
| Своё на странице | контекст, заселение, пакетные функции, области правки, `notice` | выбор набора кадров, подпись под сценой | стили, док материалов, вторая панель, `notice` | референсы не обязательны | одно фото, `ModelStage`/`ModelChip` |

Страницы после выноса общего: `enhance` ≈ 420 строк, `restyle` ≈ 375, `views` ≈ 275,
`materials` ≈ 220, `photo-3d` ≈ 330 — в них только конфигурация и логика инструмента.

---

## Как собрать новый инструмент

```tsx
"use client"

const LABELS: ToolComposerLabels = { /* тексты композера */ }
const OPTIONS: ToolOption<MyOption>[] = [ /* выбор-сегмент */ ]

export default function MyToolPage() {
  const activeProject = useActiveProject()
  const items = useMyStore((s) => s.items) // + add / update / remove

  const intake = useAttachments({ maxFiles: MAX_BATCH })
  const batch = useBatchSelection(intake, { noun: LABELS.batchNoun }) // если пачка смотрится на сцене
  const [note, setNote] = useState("")
  const [option, setOption] = useState<MyOption>("auto")

  const visible = activeProject ? items.filter((i) => i.projectId === activeProject.id) : []
  const showComposer = intake.attachments.length > 0 || visible.length > 0
  const composer = usePresence(showComposer)
  const tray = usePresence(intake.attachments.length > 0)

  const startBatch = async (files: File[]) => {
    const project = ensureActiveProject()
    const metas = []
    for (const file of files) {
      const { id, width, height } = await saveSourceFile(file)
      metas.push({ id, projectId: project.id, status: "processing", note, /* … */ })
    }
    await runGalleryQueue(metas, add, runMyEngine)
  }

  const submit = () => {
    if (intake.attachments.length === 0) return intake.pickFiles()
    const { files } = batch.takeWorkingSet()
    setNote("")
    void startBatch(files)
  }

  return (
    <ToolShell intake={intake} dropLabel="Отпустите, чтобы приложить …" composerOpen={showComposer} trayOpen={tray.present}
      layers={
        <>
          <ComposerDock presence={composer} trayOpen={tray.present}>
            <ToolComposer attachments={intake.attachments} onPickFiles={intake.pickFiles}
              onRemoveAttachment={batch.removeAttachment} onClearAttachments={batch.clearAttachments}
              note={note} onNoteChange={setNote} option={option} onOptionChange={setOption}
              options={OPTIONS} labels={LABELS} onSubmit={submit} selectionLabel={batch.selectionLabel} />
          </ComposerDock>
          <ToolAside presence={tray} label="Приложенные …">
            <RenderTray {...batch.trayProps} />
          </ToolAside>
        </>
      }
    >
      {batch.current ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {batch.showBatchGrid
            ? <BatchGrid items={batch.pickedItems} title="Пакетная …" noun={LABELS.batchNoun} onLeave={batch.leaveBatch} />
            : <Stage attachment={batch.current} index={batch.focusIndex} count={intake.attachments.length}
                onPrev={batch.selectPrev} onNext={batch.selectNext} />}
          <div className="lg:hidden"><RenderStrip {...batch.trayProps} /></div>
        </div>
      ) : visible.length === 0 ? (
        <ToolDropzone onPick={intake.pickFiles} label="Добавить …" visual={<MyInvite />} title="Добавить …"
          description="…" caption="…" />
      ) : (
        <ToolGallery>{visible.map((item) => <ToolCard key={item.id} item={item} /* … */ />)}</ToolGallery>
      )}
    </ToolShell>
  )
}
```

Дальше — по README, раздел «Куда добавлять новый инструмент»: пункт меню,
стор, движок.

---

## Правила

1. **Разметка композера, панелей, сцены, дропзоны и приёма файлов живёт только в
   общих компонентах и хуках.** На странице — пропсы и своё содержимое.
2. **Отличие одного инструмента — проп, а не копия.** Если у второго
   инструмента появилась та же нужда, проп уже есть (`compact`, `overlay`,
   `armed`, `replace`, `trayRight`…).
3. **Тексты.** Общие для всех («Выбрать», «К просмотру», «Добавить»,
   «Очистить», «Отпустите…») — в компонентах; различающиеся — в `LABELS` страницы
   и пропсах (`dropLabel`, `title`, `caption`, `itemLabel`, `editLabel`).
4. **Внешний вид** — рецепты в `surfaces.css`, а не inline-стили на страницах.
5. Перед коммитом — `npm run type-check` и `npm run lint`; экраны проверяются
   в браузере вставкой картинки из буфера (paste работает на всей странице).

---

## Чек-лист новой функции

Любая новая функция на экране инструмента проходит эти шаги — тогда она с
первого дня работает по тому же принципу, что и остальное.

1. **Где она живёт?** Функция нужна больше чем одному инструменту сейчас или
   потенциально — она идёт в общий компонент или хук (проп, слот `extras`/`dock`,
   новый файл в `components/tool/`). Нужна ровно одному — остаётся на его
   странице, но собирается из общих частей (`SectionLabel`-подобные куски не
   копировать, а экспортировать из общего файла).
2. **Есть ли уже проп?** Прежде чем писать новый вариант, посмотреть таблицу
   компонентов выше: `compact`, `overlay`, `armed`, `replace`, `trayRight`,
   `extras`, `dock`, `tools`.
3. **Тексты** — в `LABELS` страницы или пропсом; общие для всех — внутри
   компонента.
4. **Внешний вид** — рецепт в `surfaces.css`, без inline-стилей на странице.
5. **Документ.** Добавить строку в карту «хочу поменять — где править» (если
   функция видна пользователю на всех экранах) и в каталог (если появился новый
   файл или экспорт). Обновить матрицу «Что у инструментов своё», если функция
   есть не у всех.
6. **Проверка.** `npm run check:ui` (входит в `npm run lint`), `npm run type-check`,
   прогон экрана в браузере.

## Автопроверка

`scripts/check-tool-ui.mjs` — страж этого документа. Запускается командой
`npm run check:ui`, входит в `npm run lint` и в хук Claude Code
(`.claude/settings.json`, PostToolUse на Edit/Write): после каждой правки файла
из `src/app/(main)`, `src/components`, `src/lib/use-*`, `src/styles` или самого
документа проверка выполняется автоматически, и при нарушении ассистент
получает список проблем и обязан их исправить до завершения работы.

Что проверяется:

- **Страницы инструментов** (все `page.tsx`, импортирующие из
  `components/tool/`) не содержат: `<input type="file">`, обработчиков переноса и
  вставки, `URL.createObjectURL`, классов `.stage`/`.batch-tile`/`.dropzone`/
  `.presence-*`/`columns-1 gap-4`, `<aside>`, `useMounted`/`useBlobGc`, подписи
  «выбран/выбрано», `putBlob(sourceKey…)`, очереди `[...metas].reverse()`,
  `activeProject ?? createProject()`. Каждое из этого — сигнал, что разметка
  скопирована вместо общего компонента; сообщение подсказывает, куда её вынести.
- **Каталог полный**: каждый файл `src/components/tool/*.tsx` упомянут в
  документе по имени файла, каждый экспортированный компонент (с большой буквы)
  и хук (`use…`) из `components/tool`, `components/ui`, `page-header`,
  `page-loader`, `lib/use-*`, `lib/tool-jobs` — по имени.

Список запрещённых паттернов — константа `FORBIDDEN` в скрипте; когда в общий
слой уезжает что-то новое, туда добавляется строка, чтобы копия не вернулась.
