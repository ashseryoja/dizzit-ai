# Creative Lab

Отдельная лаборатория `/creative-lab`, не часть обычных инструментов проекта:
ролики для Instagram из фотографий дизайнера. Девять motion-шаблонов на
**Hyperframes** (HTML + CSS + GSAP, рендер headless Chrome → FFmpeg) и один
ИИ-шаблон «Бумажный мир» (изображение). Видео без звука; экспорт H.264 MP4,
30 fps, Reels 1080×1920 (9:16) и лента 1080×1350 (4:5). ИИ-фото — PNG с длинной
стороной 2048 px. ИИ вызывается только по кнопке пользователя.

## Принципы шаблонов — жёсткий редакторский язык (выбор владельца, октябрь 2026)

Первая версия (бумага, серif, медленные фейды) была отклонена как «свадебная».
Ориентир — Dezeen / Architizer: быстро, крупно, контрастно.

- **Типографика.** Тяжёлый гротеск во весь кадр + моноширинные индексы, пять
  стилей (`.t-giant / .t-display / .t-head / .t-body / .t-mono` плюс `.t-num` и
  `.t-quote` в `_shared/lab.css`). Шрифты с кириллицей: Golos Text 400–900 и
  JetBrains Mono, OFL, файлы в `public/creative-lab/hf/_shared/fonts/`. Заголовки
  uppercase с плотным трекингом. Без серifов, курсива, теней и обводок.
- **Цвет.** Почти чёрный `--ink #101010` / off-white `--off #ededea` + один
  сигнальный акцент `--accent` (по умолчанию `#ff5a1f`, переменная `accent`
  в каждом шаблоне, выбирается в редакторе). Темы `dark` (по умолчанию) и
  `light`. Инверсные блоки `.block`, толстые полосы `.bar`. Гигантские цифры
  `.num` через `mix-blend-mode: difference` читаются на любом фото.
  Едва заметное зерно `.grain` (11 %), без виньетки.
- **Монтаж.** Сетка бита `B = 0.5 с` (120 BPM): склейки на 2–3 долях (1–1.5 с),
  резкие — без фейдов между кадрами. `cut` (snap-масштаб 1.08 → 1 за 0.45 с),
  `wipe` (жёсткая шторка `power4.inOut` за 0.4 с), `slide` (split-screen),
  `slam` (текст из-под маски за 0.45 с), `type` (слова по четвертям доли),
  щелчки `set` со stagger B/8 для сборки сеток. Камера — медленный наезд
  0.6–1.2 %/с между склейками. Запрещено: bounce/overshoot, частицы, glow,
  вращение, мягкие кроссфейды.
- **Safe-зона Reels** (`--safe-*`): верх 220, низ 340, право 130, лево 64 px; для
  4:5 — 150/150/64/64. Весь текст внутри; первый кадр — готовая фотография, не
  титр. Гигантский индекс нарочно выходит за правый край. Редактор показывает
  зону и центральный 4:5-кроп превью ленты.

## Два движка

Поле `engine` в каталоге выбирает рендер: `hyperframes` (все текущие
motion-шаблоны, HTML в `public/creative-lab/hf/`) или `remotion`
(`src/creative-lab/remotion.tsx` + `composition.tsx`, тот же контракт задания
в `inputProps`: `photos`, `fields`, `theme`, `format`; шрифты из `_shared/fonts`
через `staticFile`). Worker выбирает ветку по шаблону, клиент и редактор одинаковы
для обоих; предпросмотр в браузере есть только у Hyperframes-шаблонов — для
Remotion-шаблона в редакторе показывается демо. `engine: "image"` — ИИ-картинка.

## Где хранятся файлы

- `src/creative-lab/catalog.json` — каталог: группа, число фото (`min`/`max`,
  `pairs`), подписи к кадрам (`captions`), текстовые поля (`fields`), оценка
  длительности (`timing`), демо-фото.
- `src/creative-lab/types.ts` — типы и константы; `compose.ts` — переменные
  композиции, подмена формата, сборка srcdoc для предпросмотра (зеркало
  `scripts/creative-lab/validation.mjs`, который использует worker).
- `public/creative-lab/hf/<id>/index.html` — композиция Hyperframes шаблона.
  `public/creative-lab/hf/_shared/` — общий слой: `lab.css`, `lab.js`, GSAP,
  рантайм Hyperframes (`runtime.js`, для плеера предпросмотра), шрифты, зерно.
- `public/creative-lab/demos/` — MP4 540 px и JPEG-обложки для каталога. В Git.
- `public/creative-lab/examples/` — готовый пример ИИ-фото. В Git.
- `.data/creative-lab/<uuid>/` — `assets/N.jpg`, `input.json`, `job.json`,
  `result.mp4` / `result.png`. Папка на диске, исключена из Git. На время рендера
  рядом собирается `project/` (копия `_shared` + HTML + assets) и удаляется.
- Браузер: IndexedDB `dizzit-creative-lab` (версия 2) — черновики текущих
  шаблонов. Не участвует в синхронизации или сборке мусора основных инструментов.

## Как устроен шаблон

Один HTML на шаблон. Переменные объявлены в `data-composition-variables` на
`<html>`: текстовые поля из `fields`, `theme`, и для каждого слота `photoN`,
`focusN` («x% y%» → `object-position`) и, где разрешено, `capN`. Скрипт шаблона
через `Lab.photos(max)` берёт только заполненные слоты и строит один GSAP-таймлайн
на паузе, поэтому число фото гибкое, а длительность = `tl.duration()`.
Переменные приходят как `window.__hfVariables`: worker передаёт их в
`createRenderJob`, предпросмотр инжектит их в `srcdoc` вместе с `<base>` на
папку шаблона. Формат 4:5 — та же композиция с подменой `data-format`,
`data-h`, viewport и `data-height` (`formatComposition`).

Хелперы `lab.js`: `revealImage`, `push`, `revealText`, `hideText`, `drawRule`,
`lines` (перенос по словам в `.mask > span`), `finish` (зерно, виньетка,
фиксация длительности), `register`.

## Локальный запуск

```sh
npm install
npm run creative:worker
# В другом терминале:
npm run dev
```

Нужны Node ≥ 22 и FFmpeg на PATH (`brew install ffmpeg`). При первом рендере
Hyperframes скачивает `chrome-headless-shell` (нужна сеть); проверка окружения —
`npx hyperframes doctor`. Сервис рендера по умолчанию доступен только на
`127.0.0.1:4318`. Next проксирует запросы через `/api/creative-lab/*` с обычной
авторизацией сайта и проверкой Origin. Ключ сервиса не передаётся в браузер.
Шаблоны не загружают внешние ресурсы.

```sh
npm run creative:demos            # пересобрать демо каталога (все или `-- reveal note`)
npm run check:creative            # контракт заданий и согласованность каталога
npm run check:creative:integration # отдельный временный worker, реальный MP4 4:5 и PNG, без ИИ
npx hyperframes lint public/creative-lab/hf/<id>   # линтер композиции; ожидаемые ложные
  # срабатывания: invalid_parent_traversal_in_asset_path (../_shared — worker переписывает
  # в _shared/) и missing_timeline_registry (регистрация через Lab.register)
npm run type-check
npm run lint
```

Пользовательский экспорт — 1080p, `quality: "standard"`, CRF 19; рендер 20-секундного
ролика на M-серии занимает 15–30 с. Большие наборы фото перед отправкой
адаптивно сжимаются до общего JSON < 40 МБ (лимит прокси 48 МБ).

## Размещение сайта

**Обычная serverless-функция не подходит для рендера и дискового архива:**
Chrome + FFmpeg не помещаются в функцию, а результаты живут на диске. Нужен
отдельный постоянно работающий Node.js-сервис с диском (или тот же сервер, где
размещён Next). Просто задеплоить страницу на Vercel недостаточно: каталог и
предпросмотр откроются, экспорт останется недоступен до подключения сервиса.

Настройки окружения Next:

```dotenv
CREATIVE_LAB_WORKER_URL=https://your-private-render-service.example
CREATIVE_LAB_WORKER_TOKEN=<случайный секрет не короче 24 символов>
```

Настройки процесса `npm run creative:worker`:

```dotenv
CREATIVE_LAB_HOST=127.0.0.1
CREATIVE_LAB_PORT=4318
CREATIVE_LAB_DIR=/absolute/path/on/persistent-disk/creative-lab
CREATIVE_LAB_TEMPLATES=/path/to/public/creative-lab/hf   # по умолчанию public/creative-lab/hf
CREATIVE_LAB_WORKER_TOKEN=<тот же секрет>
```

Скрипт Node не читает `.env.local` автоматически: передайте переменные процессу
через supervisor/контейнер/окружение. На одном хосте URL может быть
`http://127.0.0.1:4318`. Для другого хоста — HTTPS reverse proxy и firewall;
не открывайте незащищённый рендер в Интернет. При bind не на localhost сервис
потребует токен. Сайт должен оставаться закрыт текущей парольной авторизацией.

Реализация для личной лаборатории/одной команды: архив общий для пользователей
одного установленного сайта, **не multi-tenant**. Запускайте один worker на папку:
очередь последовательная, одновременно до пяти активных заданий. После
перезапуска queued продолжаются, interrupted rendering становятся retryable error.
Автоматического удаления результатов нет: папка растёт; входные фото сохраняются
для повтора.

## ИИ и стоимость

Бумажные шаблоны («Бумажный мир», «В бумагу») используют существующий
`requestImage` и `/api/images`, без `storeKey`: результат не попадает в основное
облачное хранилище проекта. Текст рецепта — `PAPER_PROMPT` в `types.ts`. Без
подключённого провайдера кнопка ИИ недоступна. Motion-шаблоны не вызывают ИИ.
ИИ-кадр кэшируется в черновике до отправки в очередь: повтор экспорта не вызывает
ИИ ещё раз; при замене фото или формата нужна новая генерация.

## Как добавить шаблон

1. Скопировать ближайший `public/creative-lab/hf/<id>/index.html`, задать
   `data-composition-id`, объявить переменные (поля, `theme`, `photoN`/`focusN`/`capN`
   с `label`), построить таймлайн через `window.Lab`, завершить `Lab.finish` и
   `Lab.register`. Весь текст — в safe-зоне, первый кадр — фотография.
2. Добавить запись в `catalog.json` (id совпадает с папкой; `labels.length === max`).
3. `npm run check:creative`, `npx hyperframes lint public/creative-lab/hf/<id>`,
   `npm run creative:demos -- <id>`, проверить оба формата в редакторе.

## Происхождение примера «Бумажный мир»

`public/creative-lab/examples/paper.jpg` создан встроенным imagegen (не CLI),
из локального `public/images/invite/restyle-source.jpg`. Остальные демо используют
демонстрационные изображения проекта (`public/images/invite`).
