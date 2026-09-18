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
| Улучшение качества GPT Image 2 + Lanczos 2000 px, тумблер «Заселить сцену», пакетные функции (качество, фильтр, время) | `src/components/tool/batch-tools.tsx` | `QualityToggle`, `PopulateToggle`, `BatchToolsPanel` |
| Правая панель-галерея пачки: заголовок «рендеры · 3 из 10» (у пачки без лимита — просто «рендеры · 14»), «Выбрать», плитки, производные версии, «Добавить», «Очистить», «Редактировать все» | `src/components/tool/render-tray.tsx` | `RenderTray`, `TrayThumb`, проп `renderVersion` |
| Полоска миниатюр под сценой на узких экранах | `render-tray.tsx` | `RenderStrip` |
| Папки рендеров: вкладки «Общая», «Комната 1»… и «+» у левого края правой панели, карандаш при наведении, окошко имени с удалением; на узких экранах — чипы над полоской | `src/components/tool/folder-rail.tsx` — вкладки; `src/stores/project-store.ts` — данные (`Project.folders`, `createFolder`/`renameFolder`/`deleteFolder`); `src/styles/ds/surfaces.css` — `.folder-*` | `FolderRail`; слот `rail` у `ToolAside`; принадлежность рендера — `folderId` записи; перенос между папками — `moveTargets`/`onMoveTo` у `RenderTray` (перетаскивание плитки на вкладку, кнопка «В папку» у набора) и `onDropRenders` у `FolderRail` |
| Закреплённая правая панель как поверхность (ширина, тень, рамка, анимация выезда) | `src/components/tool/tool-shell.tsx` | `ToolAside` |
| Сцена: рендер во весь экран, бейджи имени/размера и «2 / 7», стрелки; поверхность во время восстановления | `src/components/tool/stage.tsx` | `Stage`, `StagePlaceholder` |
| Пакетный грид с заголовком «Пакетное …» и кнопкой «К просмотру» | `stage.tsx` | `BatchGrid` |
| Пустой экран — дропзона с пунктиром, приглашением, заголовком и подписью | `src/components/tool/tool-dropzone.tsx` | `ToolDropzone` |
| Пустой экран редактора рендера — стеклянная карточка с интерьером, значком глаза и открытием примера | `src/components/tool/render-empty-state.tsx`; `.dropzone-glass*`, `.render-welcome-*` в `surfaces.css` | `RenderEmptyState`, `ToolDropzone variant="glass"` |
| Слой «Отпустите, чтобы приложить…», скрытый `<input type="file">`, отступы под композер и панель, скелет до гидрации | `tool-shell.tsx` | `ToolShell` |
| Положение композера внизу (отступ под сайдбар и панель, анимация появления) | `tool-shell.tsx` | `ComposerDock` |
| Галерея результатов: масонри колонками, широкие карточки одна под другой (`layout="stack"` у сетов кадров) или сетка по три квадратных тайла в ряд по центру (`layout="tiles"` у материалов, ширина — `TILE_GALLERY_WIDTH`) | `tool-shell.tsx` | `ToolGallery`, `TILE_GALLERY_WIDTH` |
| «Добавить кадр» / «Добавить интерьер», когда дропзоны уже нет: узкая полоса над галереей (`variant="bar"`, без прокрутки к концу списка; в галерее-масонри занимает всю ширину над колонками) или плитка под последним результатом (`variant="tile"`) | `src/components/tool/add-tile.tsx`; `.add-bar`, `.add-tile*` в `surfaces.css` | `AddTile`, `onClick={intake.pickFiles}` |
| Слот «Загрузить…» в панели настроек, когда пачка пуста, а композер остался (после отправки — над галереей результатов) | `tool-composer.tsx` | блок «Панель настроек», условие `selectionMode && attachments.length > 0` |
| Прокрутка наверх при смене режима экрана: сцена ↔ галерея результатов | `src/lib/use-scroll-top.ts` | `useScrollTopOnChange(hasAttachments)` |
| Выбор формата кадров (9:16, 3:4, 1:1, 4:3, 16:9) с глифами пропорций в панели настроек | `src/components/tool/aspect-picker.tsx` — секция; `src/lib/frame-aspect.ts` — список и пропорции; `src/styles/ds/surfaces.css` — `.aspect-*` | `AspectPicker`, слот `extras` композера |
| Планировщик раскадровки: сначала `describeScene` фиксирует инвентарь, затем vision-модель получает его вместе с рендером, ранжирует выразительные предметные группы и составляет список без заполнителей и дублей (`ViewFrame.region`, `brief`); универсальный сет — четыре `vantage`, чередующиеся с тремя деталями. У `vantage` четыре сценария `ViewFrame.camera` и сторона `side`; генератор получает локальный кроп плюс полный исходник, меняет только камеру, а почти неизменный результат или визуальный дубль получает один контрольный повтор. Готовый кадр — Lanczos3 до 2000 px (`VIEW_LONG_SIDE`); без ключа — кадры по составу набора | `src/lib/shot-planning.ts` — клиент; `src/app/api/shots/route.ts` + `src/server/shot-planner.ts` — сервер; `src/lib/view-presets.ts` — состав наборов слотами и сборка кадров | `planViewFrames`; `buildShotListPrompt`, `parseShotList`, `planShotList`; `PRESET_SLOTS`, `assignShots`, `framesOf` |
| Карточка результата: «до/после», скачать, удалить, статусы, повтор 2×2 для тайлов | `src/components/tool/tool-card.tsx` | `ToolCard` (у сетов кадров — своя `view-set-card.tsx`); проп `tileable`, рецепт `.tile-repeat` в `surfaces.css` |
| Правила приёма файлов: форматы, лимит, предупреждения, перенос, вставка из буфера, замена вместо добавления | `src/lib/use-attachments.ts` | `useAttachments`; константы форматов и лимитов — `src/lib/enhance-engine.ts` |
| Рабочий набор: режим «Выбрать», «Выбрать все», стрелки и Escape, «Редактировать все», что уходит в обработку | `src/lib/use-batch-selection.ts` | `useBatchSelection` |
| Сохранение исходника в IndexedDB/на сервере, серверный черновик до запуска, очередь пачки | `src/lib/tool-jobs.ts`, `src/app/(main)/enhance/page.tsx` | `saveSourceFile({ durable: true })`, статус `draft`, `runGalleryQueue` |
| Где живут записи и картинки: кэш IndexedDB, синхронизация со своим сервером, вход по паролю, подпись «серверное хранение / локальный режим» | `src/lib/server-sync.ts` — клиент (очередь, слияние, `useServerStatus`); `src/lib/blob-store.ts` — кэш блобов; `src/server/{auth,records,storage,db}.ts` + `src/app/api/{records,assets,session,auth}` — сервер; `src/middleware.ts` — дверь | `attachServerSync` в каждом сторе; `serverStatus`, `useServerStatus` |
| Куда уходит генерация картинок: positive/negative prompt, провайдер, пропорции, уменьшение референса, Lanczos-постобработка, предпросмотр без ключа, подпись «предпросмотр без ключа» на карточке | `src/lib/image-generation.ts` — клиент; `src/app/api/images/route.ts` + `src/server/image-provider.ts`, `providers.ts` (выбор), `apimodels.ts`, `laozhang.ts`, `image-postprocess.ts`, `http.ts` — сервер | `requestImage`, `composeProviderPrompt`, `withImageProvider`, `prepareReference`, `resizeToLongSideLanczos`, `previewCaption`; промпты — в движке инструмента (`build*Prompt`) |
| Разбор сцены перед улучшением: vision-модель составляет инвентарь кадра — материалы поверхностей (пол травертин, а не микроцемент; шпон дуба, а не ламинат) и предметы (телевизор выключен, шторы тюлевые, люстра горит), он уходит в промпт gpt-image-2 и хранится в записи (`sceneInventory`); выбор модели, промпт аналитика, чистка ответа, запрет подмены материалов | `src/lib/scene-analysis.ts` — клиент; `src/app/api/scene/route.ts` + `src/server/scene-inventory.ts`, `vision-provider.ts`, `providers.ts` (`resolveVisionProviders` — цепочка с запасными) — сервер; блоки промпта — `src/lib/enhance-engine.ts` | `describeScene`, `sceneAnalysisStatus`, `hasMaterialsSection`; `analyzeScene`, `buildSceneInventoryPrompt`, `tidyInventory`; `OBJECT_IDENTITY_HINT`, `MATERIAL_FIDELITY_HINT`, `sceneInventoryBlock`, `sourceQualityHint`, `EnhanceHooks.onInventory` |
| «Фото → 3D»: экран как у Meshy — панель генерации внизу (фото и ракурсы, модель, детализация, текстура/PBR/улучшение фото, «время · кредиты»), сцена с вьюером в центре, библиотека моделей справа; какие настройки есть у какой модели и сколько они стоят | `src/shared/model3d.ts` — контракт настроек, возможности моделей, оценка кредитов (один на клиент и сервер); `src/components/tool/model-dock.tsx`, `model-stage.tsx`, `model-library.tsx`; `src/lib/use-view-slots.ts` — какой файл в каком слоте; `tool-composer.tsx` — пропсы `dock`, `dockLabel`, `settingsInDock`; `tool-shell.tsx` — `composerSpace`; `.model-dock*`, `.model-slot*`, `.model-ai*`, `.model-stage*`, `.model-tile*` в `surfaces.css` | `ModelSettings`, `MODEL_AI`, `normalizeModelSettings`, `estimateModelCost`, `describeModelSettings`; `ModelDock`, `ModelStage`, `ModelLibrary`, `ModelLibraryStrip`; `useViewSlots` |
| «Фото → 3D»: куда уходит фото и откуда берётся модель — задача Meshy (Image to 3D), опрос готовности, GLB в своём хранилище под ключом `${id}:model`, возобновление опроса после перезагрузки, каркас-заглушка без ключа; три формата результата (`MODEL_FORMATS`: GLB — вьюер, FBX и OBJ-архив с материалом и текстурой — для 3ds Max/ArchiCAD/AutoCAD; докачиваются фоном, список готовых — `Model3D.formats`); просмотр GLB (вращение, зум, автоповорот; материалы без текстуры — Meshy отдаёт их без секции `materials`, и glTF подставляет белый металл — вьюер переводит в матовую серую «глину», чтобы модель не выгорала) и скачивание по форматам | `src/lib/model-engine.ts` — клиент; `src/app/api/models/route.ts`, `[taskId]/route.ts`, `[taskId]/file/route.ts` + `src/server/meshy.ts` — сервер (ключ `MESHY_API_KEY`, параметры задачи, перекладывание GLB в хранилище); `src/server/zip.ts` — архив OBJ; `src/components/tool/model-viewer.tsx` — вьюер и скачивание; `.model-viewer`, `.model-downloads` в `surfaces.css` | `modelProviderStatus`, `submitModelTask`, `awaitModelTask`, `fetchModelFile`, `readGlbStats`; `createMeshyTask`, `getMeshyTask`, `downloadMeshyModel`; `buildZip`; `ModelViewer`, `ModelDownloads`, `downloadStoredModel` |
| В какой проект класть новые записи | `src/stores/project-store.ts` | `ensureActiveProject`, `useActiveProject` |
| Альбом-презентация: из чего складывается PDF (обложка во весь лист с затемнением, содержание с номерами страниц, концепция с палитрой, общие планы и «до / после», сеты ракурсов, доска материалов, задняя страница), форматы страниц и темы, план страниц (что войдёт и сколько страниц — до сборки), тексты от ИИ, выбор состава миниатюрами, сборка по кнопке, превью PDF | `src/shared/album.ts` — контракт спецификации и **план страниц** (`planAlbum`, `splitBalanced`, `materialColumns`, `ALBUM_CAPACITY`, `MATERIAL_GRID`, `ALBUM_SECTION_TITLE`) — один на клиент и сервер; `src/lib/album-engine.ts` — сборка спецификации из записей, факты для ИИ, запросы, `formatAlbumDate`; `src/server/album-document.tsx` — вёрстка страниц (@react-pdf, страницы по плану), `album-render.ts` — шрифты (Unbounded Light/Medium — статические начертания, Garet) и картинки, `album-copy.ts` — промпт текстов, `album-images.ts` — откуда байты картинок и копии для PDF на сервере (`prepareAlbumAssets`; ключ копии `pdfKey` — в `shared/album.ts`; из кэша браузера копии выгружает `prepareAlbumImages` движка); роуты `src/app/api/album`, `/prepare` и `/copy`; `src/components/tool/album-section.tsx`, `album-picker.tsx`, `album-style-picker.tsx`, `album-build.tsx`, `album-preview.tsx`; `.album-*` в `surfaces.css` | `buildAlbumSpec`, `buildAlbumFacts`, `defaultAlbum`, `renderAlbum`, `requestAlbumCopy`, `planAlbum`; `AlbumDocument`, `loadAlbumImages`, `renderAlbumPdf`, `buildAlbumCopyPrompt`; `AlbumSection`, `AlbumPicker`, `AlbumFormatPicker`, `AlbumThemePicker`, `AlbumBuildPanel`, `AlbumBuildBar`, `AlbumPreview` |
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
| `maxFiles` | лимит пачки; по умолчанию `MAX_BATCH` (10). `Infinity` — пачка без лимита: так живёт «Редактор рендера», где панель хранит все записи проекта, а `MAX_BATCH` ограничивает только рабочий набор (`useBatchSelection.maxWorkingSet`) |
| `replace` | новые файлы заменяют приложенные («Фото → 3D»: одно фото на модель) |
| `onDetach(items, reason)` | файлы ушли из пачки; `discard` означает удалить черновик, `consume` — превратить его в задание; страница также подчищает своё по `previewUrl` |

Возвращает `AttachmentIntake`: `attachments`, `attachFiles`, `removeAttachment`,
`clearAttachments`, `detach(urls, reason)`, `restoreAttachments(items)`,
`pickFiles`, а также всё, что нужно
`ToolShell` для скрытого input и переноса (`inputRef`, `onInputChange`,
`accept`, `multiple`, `dragOver`, `dropProps`). Хук ничего не рендерит.

У каждого `AttachedRender` есть стабильный `id`. В редакторе рендера он сразу
становится записью `enhancements` со статусом `draft`: исходник и миниатюра
сохраняются в IndexedDB и, при включённом серверном хранении, в Vercel Blob;
метаданные синхронизируются с Postgres. После перезагрузки такие записи
возвращаются в `useAttachments` через `restoreAttachments`. В редакторе таким
же способом возвращаются исходники всех готовых и ошибочных обработок проекта,
без лимита по количеству, чтобы рабочая сцена и пары версий не исчезали после
refresh. Удаление пары из пачки
удаляет её запись и объекты.

### `useBatchSelection(intake, options)` — `src/lib/use-batch-selection.ts`

Рабочий набор пачки — что на сцене и что уйдёт в обработку. Обычный режим:
клик по плитке — один рендер на сцену, он же в обработку. Режим «Выбрать» (как
в «Фото» iOS): клики набирают несколько, обработка ко всем сразу. Стрелки
листают сцену, Escape выходит из режима выбора (если каретка не в поле ввода).

| Опция | Смысл |
| --- | --- |
| `noun` | формы слова для подписи: `["рендер", "рендера", "рендеров"]` |
| `onEditAll` / `onLeaveBatch` | что ещё сделать при входе/выходе из пакетного режима (редактор рендера открывает и закрывает настройки) |
| `maxWorkingSet` | сколько рендеров уходит в обработку за раз (редактор рендера — `MAX_BATCH`); набор больше лимита не урезается, вместо этого хук отдаёт `limitNotice` — страница передаёт его в `submitBlockedReason` композера |

Возвращает `BatchSelection`: `current`, `focusIndex`, `pickedItems`,
`workingSet`, `showBatchGrid`, `selectionLabel`, `limitNotice`, обработчики
(`selectAttachment`, `togglePicking`, `editAll`, `leaveBatch`, `pickAll`,
`selectPrev`/`selectNext`, `removeAttachment`, `clearAttachments`),
`takeWorkingSet()` — забирает набор в обработку и сбрасывает выбор, и
`trayProps` — пропсы `RenderTray`/`RenderStrip` одним объектом:
`<RenderTray {...batch.trayProps} />`.

`takeWorkingSet({ retain: true })` завершает режим пакетного выбора, но не
убирает исходники со сцены. Так работает «Редактор рендера»: во время
обработки исходник остаётся большим, а после неё на его месте показывается
результат. Новый файл, добавленный к непустой пачке, автоматически становится
текущим — следующую обработку можно запустить сразу.

Если на сцене выбрана плитка «новый», повторная точечная правка берёт текущий
результат как вход (`Enhancement.inputRole = "result"`) и перезаписывает только
новую версию пары. Серверный исходник остаётся прежним.

Набор ведётся по `previewUrl`: он уникален и переживает удаление соседей.
Инструменты без просмотра пачки на сцене («Материалы», «Фото → 3D») этот хук
не используют — им хватает `useAttachments`.

### Помощники

- `saveSourceFile(file, options)` (`src/lib/tool-jobs.ts`) — исходник и
  миниатюра в IndexedDB под новым или стабильным `options.id`; с
  `durable: true` ждёт серверную копию. Возвращает `{ id, width, height }`.
- `runGalleryQueue(metas, add, run)` — карточки появляются все сразу,
  обработка по одной; порядок галереи совпадает с порядком выбора файлов.
- `ensureActiveProject()` (`src/stores/project-store.ts`) — промис активного
  проекта; без него — новый «Проект N», но только после сверки списка с
  сервером (`synced` в сторе), иначе в новом браузере фантомный проект
  появлялся бы раньше настоящих и уезжал на сервер. Для колбэков вне рендера.
  В рендере — `useActiveProject()`.
- `fileBaseName(name, fallback)` (`src/lib/utils.ts`) — имя без расширения для
  скачивания.
- `requestImage(...)`, `withImageProvider(remote, preview)`,
  `prepareReference(blob)` (`src/lib/image-generation.ts`) — один вход к
  провайдеру картинок для всех движков; без ключа — локальный предпросмотр,
  помеченный `engine: "preview"`. `previewCaption(item)` — хвост подписи
  карточки для такого результата (`ToolCard`, `ViewSetCard`).
- `describeScene(blob, { context })` (`src/lib/scene-analysis.ts`) — инвентарь
  предметов кадра от vision-модели через `/api/scene`; `null`, если разбор
  выключен или не удался — движок продолжает без него. `enhanceRender(source,
  job, { onInventory })` зовёт его сам и отдаёт инвентарь странице до платной
  генерации, чтобы запись (`Enhancement.sceneInventory`) переиспользовала его на
  повторе.
- `attachServerSync(store, options)` (`src/lib/server-sync.ts`) — одна строка в
  конце файла стора: слияние с сервером при гидрации и отправка изменений;
  `useServerStatus()` — статус для компонентов (сайдбар, настройки).
- `mapWithConcurrency(items, limit, run)` (`src/lib/utils.ts`) — несколько
  запросов к провайдеру разом с потолком (кадры сета в «Ракурсах»).
- `planViewFrames(blob, { preset, aspect, note })` (`src/lib/shot-planning.ts`) —
  список кадров сета от vision-модели через `/api/shots`; `null`, если
  планировщик выключен или не ответил — сет строится по составу набора
  (`framesOf`). Список хранится в записи (`ViewSet.frames`, `planned`), и
  «Повторить» его не пересчитывает.
- `FRAME_ASPECTS`, `frameAspectRatio`, `frameAspectCss`, `closestFrameAspect`
  (`src/lib/frame-aspect.ts`) — форматы кадров и их пропорции для генерации,
  обрезки и плиток.
- `useViewSlots(intake, multiView)` (`src/lib/use-view-slots.ts`) — слоты фото
  «Фото → 3D» поверх общей пачки: клик по слоту делает его целью следующего
  приложенного файла (диалог, перенос, вставка), занятый слот заменяется,
  выключенный мульти-вид убирает ракурсы. `ordered` — порядок отправки провайдеру.
- `useScrollTopOnChange(key)` (`src/lib/use-scroll-top.ts`) — страница наверх
  при каждой смене `key`: инструменты со сценой передают `hasAttachments`,
  чтобы после отправки была видна новая карточка в голове галереи, а после
  добавления исходника из глубины галереи — сцена.

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
| `composerSpace` | класс этого отступа (`pb-32` по умолчанию); больше, когда над композером постоянная секция `dock` |
| `trayOpen`, `trayMargin` | справа открыта панель; класс отступа (`lg:mr-[296px]`, у переноса стиля с двумя панелями — `lg:mr-[296px] xl:mr-[588px]`) |
| `layers` | плавающие слои: `ComposerDock`, `ToolAside` |
| `children` | содержимое экрана |

### `ComposerDock`, `ToolAside`, `ToolGallery` — там же

- `ComposerDock` — полоса внизу, в которой живёт `ToolComposer`. С `presence`
  (результат `usePresence`) появляется и уходит анимацией, без него есть всегда
  («Материалы»). `trayOpen` + `trayRight` двигают правый край при открытой панели.
- `ToolAside` — закреплённая правая панель как поверхность: зеркало сайдбара.
  По умолчанию позиция панели пачки (`right-4 w-[264px] lg:flex`); панель
  стилей передаёт `className="right-[292px] w-[280px] xl:flex"`. Слот `rail`
  рисует вкладки снаружи левого края (папки рендеров); страница тогда
  расширяет отступы `trayMargin` у `ToolShell` и `trayRight` у `ComposerDock`
  на ширину вкладок (40 px).
- `ToolGallery` — колонки масонри для карточек. `layout="tiles"` — сетка
  3 × квадратные тайлы по центру (материалы): карточки одинаковые, масонри им
  не нужно. Ширину сетки задаёт экспорт `TILE_GALLERY_WIDTH` из того же файла —
  его же берёт превью-сетка пустого экрана, чтобы раскладка не прыгала после
  первой генерации.

### `ToolComposer` — `src/components/tool/tool-composer.tsx`

Композер с панелью настроек. Тексты — `ToolComposerLabels` (заголовки секций,
плейсхолдер, подпись кнопки, формы слова пачки), опции — `ToolOption<T>[]`.
Ключевые режимы:

- `selectionLabel` задан — **режим выбора**: пачкой управляет панель-галерея, а
  композер показывает «выбрано N» и не рисует чип и секцию файлов. При пустой
  пачке (`null`) секция файлов возвращается слотом «Загрузить…»: панели в этот
  момент нет, а новый исходник после отправки нужен не только переносом и
  вставкой из буфера. Главная кнопка при пустой пачке открывает выбор файла
  (страницы делают это в `submit`).
- `tools` задан — панель настроек показывает **только** его (пакетные функции).
- `extras` — дополнительные секции обычной панели (тумблер заселения).
- `dock` — постоянная секция над композером (материалы стиля).
  `dockLabel` — её подпись для скринридера. `settingsInDock` — все настройки
  уже в этой секции («Фото → 3D»): шестерёнки, панели настроек и чипа файлов нет.
- `regionTags`, `submitBlockedReason`, `placeholder`, `notice`, `attentionKey` —
  точечная правка и подсказки. Пока список проектов не сверен с сервером и
  активного проекта нет (новый браузер), композер сам закрывает кнопку с
  подсказкой «Загружаем проекты…» — см. `ensureActiveProject`.

### `RenderTray`, `RenderStrip` — `src/components/tool/render-tray.tsx`

Панель-галерея пачки и её узкая версия. Пропсы приходят из
`batch.trayProps`; сверх них — `title` («интерьеры») и `editLabel`
(«Перенести», «Построить»). `sourceLabel` подписывает исходную плитку, а
`renderVersion(attachment, index)` добавляет рядом производную плитку. В
«Редакторе рендера» это пара «исходник / новый»; новая версия показывает
состояния обработки и ошибки и выбирается на большой сцене независимо от
исходника. `moveTargets` + `onMoveTo(ids, folderId)` включают перенос в папки:
плитки становятся перетаскиваемыми (в режиме «Выбрать» уезжает весь набор), а
рядом с «Редактировать все» появляется кнопка «В папку» со списком папок.

### `FolderRail` — `src/components/tool/folder-rail.tsx`

Папки рендеров — вкладки у правой панели, как закладки у блокнота. Первая,
«Общая» (`activeId === null`), показывает все записи проекта; дальше папки
пользователя, последняя — «+» (создаёт «Комната N» и сразу открывает
переименование). При наведении над вкладкой появляется карандаш; окошко имени
сохраняет по Enter или клику мимо, там же кнопка удаления папки — её рендеры
остаются в проекте и видны в «Общей». Папки хранятся в записи проекта
(`Project.folders`, действия `createFolder`/`renameFolder`/`deleteFolder` в
`project-store`), принадлежность рендера — поле `folderId` его записи: новые
черновики получают папку, открытую в момент добавления. В «Редакторе рендера»
смена папки перестраивает пачку через обычное восстановление исходников
(`restoreAttachments`), поэтому лимитов и копий у папок нет.
`orientation="horizontal"` — чипы над `RenderStrip` на узких экранах.

Перенос между папками: `onDropRenders(ids, folderId)` принимает плитки,
перетащенные из `RenderTray` (MIME `RENDER_DRAG_TYPE`, список id записей);
вкладка под курсором подсвечивается. Слой «Отпустите, чтобы приложить…»
(`useAttachments.dropProps`) на такой перенос не реагирует — только на файлы.

### `Stage`, `BatchGrid` — `src/components/tool/stage.tsx`

- `Stage` — рендер во весь экран с бейджами и стрелками. `overlay` (холст
  точечной правки) переключает раскладку: картинка ложится в бокс ровно по
  кадру, размер считается по пропорции. `itemLabel` — для подписей стрелок,
  `className` — размер сцены (`aspect-[4/3] w-full` у переноса стиля).
- `StagePlaceholder` — та же большая поверхность без изображения: например,
  пока рабочая пара восстанавливается из серверного хранилища.
- `BatchGrid` — грид рабочего набора с заголовком и «К просмотру»;
  `compact` — для узкой колонки переноса стиля.

### `ToolDropzone` — `src/components/tool/tool-dropzone.tsx`

Пустой экран: кнопка-дропзона с SVG-пунктиром, внутри `visual`
(приглашение инструмента: `RenderReveal`, `StyleSwap`, `ViewsInvite`,
`FurnitureMorph`), заголовок, описание и подпись под зоной. `armed` —
файл уже приложен (фото → 3D). `className` — ширина и поля обычной кнопки.
`variant="glass"` — утверждённая стеклянная карточка без пунктира;
`actionLabel` и `hint` добавляют визуальную кнопку и подсказку форматов,
`footer` — отдельное действие под подписью, вне кнопки загрузки.

### `RenderEmptyState` — `src/components/tool/render-empty-state.tsx`

Собирает `ToolDropzone variant="glass"` для редактора рендера: локальное
изображение `public/images/render-example.jpg`, статический стеклянный ScanEye,
загрузка через `onPick` и ссылка «Посмотреть на примере». Ссылка загружает
пример через общий `onAttachFiles` (`useAttachments.attachFiles`) и открывает
обычный редактор; генерацию не запускает. Есть состояние загрузки и ошибка
с повтором. При смене проекта компонент перемонтируется и отменяет запрос.
Приём файлов переносом, выбором и вставкой остаётся в `ToolShell` / `useAttachments`.

### `ToolCard`, `ViewSetCard` — карточки результата

`ToolCard` общая: миниатюры и полные файлы из IndexedDB/серверного хранилища,
«до/после» по удержанию, скачать, удалить, повтор при ошибке. `tileable` —
результат должен повторяться без шва (материалы): кнопка «Повтор 2×2» кладёт
результат четырьмя копиями встык через `background-repeat` (`.tile-repeat`),
стык — в центре карточки, шов виден сразу. `useStoredBlobUrl`
проверяет запасные ключи по порядку, ограниченно ждёт запаздывающий объект и
возвращает `loading / ready / missing / error`. В терминальном состоянии
`StoredAssetNotice` оставляет размеры карточки стабильными и предлагает только
«Проверить снова» — без повторной генерации. У «Ракурсов» своя `ViewSetCard` —
контактный лист из кадров сета с тем же поведением для каждой плитки.

### Каталог: все файлы общего слоя

Проверка `npm run check:ui` требует, чтобы **каждый** файл `src/components/tool/`
и каждый экспортированный компонент или хук были в этом документе. Новый файл —
новая строка здесь.

| Файл | Экспорт | Что это |
| --- | --- | --- |
| `tool-shell.tsx` | `ToolShell`, `ComposerDock`, `ToolAside`, `ToolGallery`, `TILE_GALLERY_WIDTH` | каркас экрана и плавающие слои (без `intake` — экран без приёма файлов: альбом); ширина сетки тайлов |
| `tool-composer.tsx` | `ToolComposer` | композер с панелью настроек |
| `render-tray.tsx` | `RenderTray`, `RenderStrip` | панель-галерея пачки и полоска миниатюр |
| `folder-rail.tsx` | `FolderRail` | папки рендеров: вкладки у правой панели, переименование и удаление |
| `stage.tsx` | `Stage`, `StagePlaceholder`, `BatchGrid` | сцена, её состояние восстановления и пакетный грид |
| `tool-dropzone.tsx` | `ToolDropzone` | пустой экран-дропзона |
| `tool-card.tsx` | `ToolCard`, `StoredAssetNotice`, `useBlobUrl`, `downloadStoredResult` | карточка результата (`tileable` — повтор 2×2 для бесшовных тайлов); стабильное состояние отсутствующего файла; совместимый хук «блоб → object URL»; скачивание полного результата |
| `view-set-card.tsx` | `ViewSetCard` | карточка сета кадров («Ракурсы»): общий план слева, кадры справа |
| `aspect-picker.tsx` | `AspectPicker` | выбор формата кадров с глифами пропорций — секция панели настроек |
| `add-tile.tsx` | `AddTile` | «добавить ещё» в галерее результатов: полоса над списком (`variant="bar"`) или плитка (`tile`) — пунктир, плюс, подпись; по клику — выбор файла |
| `src/lib/use-stored-blob.ts` | `useStoredBlobUrl` | загрузка с fallback-ключами, ограниченный автоповтор и ручная проверка серверного файла |
| `batch-tools.tsx` | `BatchToolsPanel`, `QualityToggle`, `PopulateToggle` | улучшение качества, пакетные функции и тумблер «Заселить сцену» |
| `region-editor.tsx` | `RegionEditor` | холст точечной правки поверх сцены (кисть, обводка, рамка) |
| `style-dock.tsx` | `StyleDock` | материалы выбранного стиля с галочками — секция над композером |
| `style-picker.tsx` | `StylePicker` | список стилей рядом со сценой с окошком-превью |
| `style-scenes.tsx` | `StyleScene` | нарисованная комната в заданном стиле (превью стиля, приглашение) |
| `style-swap.tsx` | `StyleSwap` | приглашение «Переноса стиля»: комната, в которой меняется стиль |
| `material-swatch.tsx` | `MaterialSwatch` | плашка материала (дерево, камень, ткань…) для стилей |
| `material-preview-grid.tsx` | `MaterialPreviewGrid` | пустой экран «Материалов»: сетка заготовок |
| `render-reveal.tsx` | `RenderReveal` | приглашение «Редактора рендера»: живое «до/после» |
| `render-empty-state.tsx` | `RenderEmptyState` | стеклянный пустой экран редактора с интерьером и открытием примера |
| `views-invite.tsx` | `ViewsInvite` | приглашение «Ракурсов»: общий план и кадры из него |
| `room-sketch.tsx` | `RoomSketch` | эскиз комнаты (SVG) для приглашений |
| `furniture-morph.tsx` | `FurnitureMorph` | каркасы мебели, перетекающие друг в друга («Фото → 3D») |
| `model-dock.tsx` | `ModelDock` | панель генерации «Фото → 3D» над композером (`dock`), по образцу левой панели Meshy: слоты фото «Главный вид / Слева / Сзади / Справа» с тумблером мульти-вида, выбор модели (Meshy 7 / 6 / 6 Lite) и детализации, тумблеры текстуры, PBR и улучшения фото, оценка «время · кредиты», сворачивание |
| `model-stage.tsx` | `ModelStage` | сцена модели: вьюер GLB (или каркас-заглушка), фото-исходники, статистика сетки, свотчи фона и автоповорот, тулбар «скачать · повторить · удалить», ход задачи и ошибка |
| `model-library.tsx` | `ModelLibrary`, `ModelLibraryStrip` | библиотека моделей проекта: сетка превью в правой панели (`ToolAside`) и полоска под сценой на узких экранах; статус задачи на плитке, дата и удаление по наведению |
| `model-viewer.tsx` | `ModelViewer`, `ModelDownloads`, `downloadStoredModel` | просмотр настоящего GLB из хранилища (`<model-viewer>`, подгружается лениво) и плашка скачивания по форматам «GLB · FBX · OBJ» («Фото → 3D») |
| `album-section.tsx` | `AlbumSection` | шаг настройки альбома: панель с номером, заголовком и строкой-итогом |
| `album-picker.tsx` | `AlbumPicker` | выбор состава альбома: сетка миниатюр готовых записей с номерами порядка, «выбрать все / снять все»; режим `single` с плиткой «без картинки» — обложка |
| `album-style-picker.tsx` | `AlbumFormatPicker`, `AlbumThemePicker`, `ALBUM_FORMAT_OPTIONS`, `ALBUM_THEME_OPTIONS` | формат страниц с глифами пропорции листа и тема с глифом тёмного/светлого листа |
| `album-build.tsx` | `AlbumBuildPanel`, `AlbumBuildBar`, `albumBuildResult`, `AlbumBuildState` | панель сборки: структура будущего PDF по плану страниц, кнопка «Собрать PDF» → «Скачать PDF» → «Собрать заново», итог сборки, превью; компактная полоса для `ComposerDock` на узких экранах |
| `album-preview.tsx` | `AlbumPreview` | превью альбома: собранный PDF во встроенном просмотрщике, вуаль состояния с прогрессом подготовки картинок, «показана прежняя версия» |

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

Хуки общего слоя: `useAttachments`, `useBatchSelection`, `useScrollTopOnChange`
(`src/lib/`), помощники `saveSourceFile`, `runGalleryQueue` (`src/lib/tool-jobs.ts`).

---

## Что у инструментов своё

| | Редактор рендера | Ракурсы | Перенос стиля | Материалы | Фото → 3D |
| --- | --- | --- | --- | --- | --- |
| `ToolShell` + `ComposerDock` + `ToolComposer` | ✓ | ✓ | ✓ | ✓ (композер всегда) | ✓ (`maxFiles=1`) |
| `useAttachments` | ✓ | ✓ | ✓ | ✓ | ✓ (`replace`) |
| `useBatchSelection`, `RenderTray`/`RenderStrip`, `ToolAside` | ✓ | ✓ | ✓ (+ панель стилей) | — | — |
| `Stage` | ✓ с `overlay` (RegionEditor) | ✓ | ✓ `aspect-[4/3]` | — | — (своя `ModelStage`) |
| `BatchGrid` | ✓ | ✓ | ✓ `compact` | — | — |
| `ToolDropzone` | ✓ `glass`, RenderEmptyState | ✓ ViewsInvite | ✓ StyleSwap | — (MaterialPreviewGrid) | ✓ FurnitureMorph, `armed` |
| `ToolGallery` + карточка | — (результат остаётся на Stage) | ✓ `layout="stack"`, ViewSetCard | ✓ ToolCard | ✓ `layout="tiles"`, ToolCard | — (сцена + лента) |
| `AddTile` («добавить ещё» в галерее результатов) | — (пачка остаётся в панели) | ✓ полоса «Добавить кадр» над сетами | ✓ полоса «Добавить интерьер» над результатами | — (композер всегда) | — |
| Своё на странице | постоянная пара «исходник / новый» в `RenderTray`, результат на Stage, контекст, разбор сцены (инвентарь предметов) + качество GPT Image 2 + Lanczos 2000 px, заселение, пакетные функции, области правки, `notice` | выбор набора кадров, формат кадров (`AspectPicker` в `extras`, панель открывается сама, `submitBlockedReason` + `notice` до выбора), планировщик кадров перед генерацией, подпись под сценой | стили, док материалов, вторая панель, `notice` | референсы не обязательны; карточка с `tileable` («Повтор 2×2» — проверка шва) | одно фото, `ModelStage`/`ModelChip` |

Страницы после выноса общего: `enhance` ≈ 420 строк, `restyle` ≈ 375, `views` ≈ 275,
`materials` ≈ 220, `photo-3d` ≈ 330 — в них только конфигурация и логика инструмента.

**«Альбом-презентация»** (`src/app/(main)/album/page.tsx`) — экран другого рода:
он не генерирует, а собирает PDF из готовых записей всех инструментов. Поэтому
`ToolShell` без `intake` (файлы не принимаются) и без сцены; слева — три шага
`AlbumSection` (состав из `AlbumPicker`, обложка и тексты, оформление из
`AlbumFormatPicker` / `AlbumThemePicker`), справа — `AlbumBuildPanel`: структура
будущего PDF по плану `planAlbum`, кнопка сборки и `AlbumPreview`. Сборка
начинается только по кнопке; после правок панель предлагает собрать заново.
На узких экранах в `ComposerDock` живёт `AlbumBuildBar` с той же кнопкой.
Данные — `src/stores/album-store.ts` (коллекция `albums`, без блобов), сборка и
запросы — `src/lib/album-engine.ts`, вёрстка PDF — `src/server/album-document.tsx`.

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
    const project = await ensureActiveProject()
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


## Liquid Glass (18 сентября 2026)

Общий визуальный материал задаёт `src/styles/ds/liquid-glass.css`, базовые
нейтральные цвета, радиусы и типографику — `colors_and_type.css`.
`surfaces.css` сохраняет геометрию и состояния компонентов. Стекло используется
в AppSidebar, ToolAside, ToolComposer и Panel; выпадающие меню получают плотную
подложку, чтобы текст читался поверх картинок. Светлая и системная темы сохранены.

Блик, следующий за курсором, удалён по обратной связи пользователя. Глубину
стекла создают статические нейтральные градиенты, blur подложки и мягкий верхний
рефлекс. Белая кнопка не меняет тип заливки при наведении: анимируется только тень.

ToolShell показывает название инструмента и проект над рабочей сценой.
ToolComposer использует многострочное поле: Enter отправляет, Shift+Enter
переносит строку; IME-композиция не отправляет запрос. Все прежние обработчики,
настройки, подсказки блокировки, вложения и теги областей сохранены. Для 3D
с отдельной панелью параметров оставлен компактный ввод. Остальные композеры
занимают ширину рабочей сцены; нижний резерв ToolShell увеличен под их высоту.

Важно: не добавлять blur/transform на ToolShell или другие предки фиксированных
панелей. Не менять пропорции `.stage-frame`: они используются редактором областей.
Изображения, API, хранилища, авторизация, экспорт и обработчики инструментов
при смене визуального материала не меняются.
