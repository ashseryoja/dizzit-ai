# Исследование: «Картинка → видео» интерьера у конкурентов и в индустрии

Дата: 18.09.2026. Три параллельных исследования (≈135 поисков, ≈180 загруженных
страниц): интерьерные и архвиз-сервисы; real-estate-инструменты и практика
архвиз-комьюнити; технический разбор видеомоделей, 3D-подходов и контроля
качества. Пометки в тексте: **[Ф]/[офиц.]** — подтверждено официальной
страницей, **[3rd]** — сторонний источник, **[В]/[вывод]** — интерпретация.

## Сводка для решения

1. Почти все интерьерные сервисы (Rendair, ArchiVinci, mnml, MyArchitectAI, Veras,
   Spacely, Homestyler, Fenestra, Archome, PromeAI, Vizcom, Krea) делают одно и то
   же: картинка → пресет камеры (pan / tilt / zoom / dolly / orbit) → опционально
   промпт и конечный кадр → 5–10 с MP4 через стороннюю модель (Kling, Veo 3.1,
   Seedance, Wan, Hailuo). Модель обычно не раскрывают. Цена ~$0.7–3 за клип.
2. Никто не даёт реального «замка» на интерьер. Максимум — фраза «Nothing is
   redrawn between» у Fenestra при start+end frame и дисклеймеры «возможны
   неожиданные движения» (Rendair, Pixlmob).
3. Бенчмарк WorldScore измеряет ровно нашу задачу: у видеомоделей «послушность
   камеры» 29–38 из 100, у 3D-заземлённых методов 86–93. Гарантию даёт либо
   отказ от перерисовки пикселей (2.5D-параллакс по глубине), либо явная 3D-сцена
   (World Labs Marble ≈ $1.20 за мир). Промпт и негативы лишь снижают вероятность.
4. Рабочие приёмы практиков: один медленный ход камеры на клип, 5 с, первый
   кадр = последний кадр («бумеранг»), либо start+end из двух согласованных
   рендеров одной сцены, склейка коротких клипов, негативы «warping walls,
   floating furniture, bending lines, double windows, people, text».
5. Kling 3.0 / Omni убрали `camera_control` и `cfg_scale` [3rd]; структурные
   команды камеры остались у Hailuo (`[Push in]`, `[Truck left]`…), Luma
   (`concepts`, `loop`, `keyframes`) и Kling ≤ 2.x (`camera_control`, `static_mask`).
   Через наш шлюз API Models доступны Kling V3, Seedance 2.x, Veo 3.1, Hailuo H3,
   Wan 3.0 — параметры проверять пробой.
6. Окно для Dizzit: «строгий» детерминированный режим, проверка дрейфа с
   вердиктом на карточке, start+end из наших же «Ракурсов», ограничение
   амплитуды, предупреждения о зеркалах/окнах/людях/тексте до траты кредитов.

---

# Часть 1. Интерьерные и архвиз-сервисы

## TL;DR

1. **Почти все** (Rendair, ArchiVinci, mnml, MyArchitectAI, Veras, Spacely, Homestyler, Fenestra, Archome, ZSky, Rendore, MeltFlex, PromeAI, Vizcom, Krea) делают одно и то же: одна картинка → пресет камеры (pan/tilt/zoom/dolly/orbit) + опциональный промпт + опциональный **end-frame** → 5–10 с MP4 через сторонний генеративный видео-модель (Kling / Veo 3.1 / Seedance / Wan / Hailuo / Grok Imagine). Никто из них не показывает пользователю название модели в маркетинге — только Archome, MeltFlex, Fenestra (через прессу), PromeAI, Krea называют модели явно.
2. **Ни один архвиз-сервис не даёт настоящего «lock scene» тумблера** (запрет на изменение геометрии/мебели). Максимум — фраза «Nothing is redrawn between» у Fenestra при start+end frame и советы «prompt specifically».
3. **Единственный тренд на честную геометрию** — не видео-модели, а **3D-реконструкция**: World Labs Marble (Gaussian splat из одной картинки) уже встроен в Interior AI (Levels), Fenestra и home-design.ai; TwoFrame делает «депт + два кадра»; Immersity/DepthFlow — 2.5D-параллакс. Это ниша, где ещё нет продукта «интерьер → видео с камерой, где ничего не поменялось».
4. Цены везде ~**$0.7–3 за 5-секундный клип** на подписке; Homestyler заявляет 10 кредитов/сек.

## Сводная таблица

| Сервис | Где сидит | Пресеты камеры | Длит./разреш. | End-frame | Промпт | Модель | Цена за клип (вывод) |
|---|---|---|---|---|---|---|---|
| **Veras (Chaos)** | вкладка Video в Veras (Enscape/V-Ray/Corona/Web) | pan, zoom, tilt, flythrough; «12 video presets» | 4/6/8 с; до 4K (Veo 3.1), 1080p (Lite) | да (first+last) | да | **Veo 3.1 / Fast / Lite**, Grok Imagine, Gemini Omni (v2v) | ~10 кредитов; Starter 500 кр ≈ 50 видео |
| **Rendair** | Video Tool в чат-интерфейсе | Pan L/R, Zoom (Dolly In/Out), Tilt, Drone Shot, Wide Shot, Cinematic Drone | ~5 с; resolution «зависит от входа» | да | да | не раскрыта | 500 кр = 25 видео → **~$0.76** (Starter $19) |
| **ArchiVinci** | отдельный tool «AI Image to Video» | Pan / Tilt / Zoom in / Zoom out / None + стрелки направления | 10 с | да (Start & End) | да + negative | не раскрыта | 5/10/20 монет (Normal/High/Best) → **~$1.6–6.4** |
| **mnml.ai** | отдельная страница Video AI | Static, pan, zoom in, zoom out, orbit, dolly | ~10 с; Flash 768p / Cinematic 1080p; ambient sound | да | да (до 4000 симв.) | не раскрыта (два «движка») | Flash 100 кр; Lite $29 = 10 видео → **~$2.9** |
| **MyArchitectAI** | отдельная страница Animations | «30+ presets»: Aerial Reveal, Furnish, Living Space, Day to Night, Assemble, Glide… + текстом | 90–120 с генерации; длит. не указана | нет данных | да | не раскрыта | Studio $49 = 50 анимаций → **~$1** |
| **Spacely AI** | tool «Image to Video» (Beta, post-process) | нет данных | 8 с | да («one or two frames») | ? | не раскрыта | не указано; 15 free кр ≈ 4 видео (5 с) |
| **Homestyler AI Animator** | AI Studio → tab ai_video + кнопка в 3D-редакторе | шаблоны: Growth, Build, Time-lapse, Storyboard, **Walkthrough**, Furniture Display, Seasonal Shift, None | слайдер длительности; 720p/1080p; 16:9/9:16/1:1 | да (opening+ending) | авто/ручной | не раскрыта | **10 кр/с 720p, 12 кр/с 1080p** |
| **Interior AI (Levels)** | кнопка на рендере + отдельный 3D-viewer | нет пресетов («flythrough») | несколько минут генерации | нет | нет | **Stable Video Diffusion** (видео) + **World Labs API** (сплаты) | по тарифу Pro/Premium/Ultra |
| **Fenestra** | отдельный solution «AI Video Generator» | Orbit, push-in, pan, dolly, flythrough + текст | MP4 «high-res», 16:9 | да | да | «several models»; пресса: **Seedance 2.0**, 720p | $8–48/мес, 200–2000 кр |
| **Archome AI** | tool Video | Zoom In/Out, Pan L/R, Dolly In, Orbit, Auto | 5/10 с; 720p Kling 1.6 / 1080p Seedance Pro / Veo 3; 16:9, 9:16, 1:1 | нет | да (2000 симв.) | **Kling 1.6 / Seedance Pro / Veo 3** | 50–400 кр ≈ **$1.5–12** |
| **PromeAI** | landing «Architecture Render to Video» + общий i2v | pan, tilt, zoom, walkthrough; Camera control только в Wan 3.0 | 5 с (до 30 с в маркетинге); 480p–4K | да | да | **Wan 3.0 (Pro/Prime), Seedance 2.5/2.0/1.5, MiniMax H3, LTX 2.3, Happy Horse** | 16–200+ монет |
| **Vizcom** | Animate-блок в Workbench | Turntable 360°, Zoom, Pan, Tilt | 10 с (Pro/Ent) | да | да | Standard / Turbo (модели не названы) | лимит по плану |
| **TwoFrame** (ex-spacelyapp) | отдельный продукт | Dolly forward, Pull back, Push-in detail, Side slide, Vertical rise, Orbit lite | 3–15 с; 720p/1080p | **обязателен** (2 кадра) | ? | «solves the depth of the room», парallax | 0.7 кр/с 1080p → **~$1/5 с** |
| **MeltFlex** | отдельный tool | Cinematic, Smooth Pan, Dolly Zoom, Orbit, First Person | 4/8 с, 24 fps, 16:9 | нет | ? | **Veo 3.1 Fast** (SynthID) | €1.85–4.72 |
| **ZSky** | отдельный tool | 5 промпт-шаблонов (Interior Walkthrough и др.) | 3–5 с; 1080p + аудио | нет | да | не раскрыта | free / $19 Pro |
| **Rendore** | tool Architectural Animation | Room reveal, Panoramic sweep, Detail showcase, Tracking shot, custom | 4–8 с | нет | да | не раскрыта | отдельный лимит |
| **home-design.ai /animate** | tool Animate | Zoom, Pan L/R, Tilt, Crab shot, Combined + 7 «эффектов» | 4/6/8 с; 720p/1080p | ? | да | не раскрыта | 16 кредитов |
| **Krea** | общий i2v + community-app «Walk-through video» | стандартные, текстом | по модели, 720p/1080p | да | да | 40+ моделей (Kling 3.0, Veo 3.1, Seedance 2.5, Wan 2.6…) | 10–1300 кр |
| **World Labs Marble** | отдельный продукт/API | pixel-accurate camera path по сплату | любое | — | — | **свой world model → 3DGS** | 1500 кр = **~$1.20 за мир** |
| **Immersity AI** | отдельный продукт | Vertical, Zoom R/C/L, Dolly, Zoom, Perspective, Circle, Horizontal | до 4K | — | нет | **depth map → параллакс** | $4.99–49.99/мес |

## Генеративные сервисы — детали

### Veras (Chaos, ex-EvolveLAB)
- Факт: image-to-video появился в Veras 3.0 (16.09.2025): «pan and zoom cameras, animate weather, change the time of day» — https://aecmag.com/visualisation/chaos-launches-ai-image-to-video-generator/
- Факт: флоу — Video tab → выбрать рендер → «Write a prompt or select a motion preset (pan, zoom, tilt, flythrough)» → «Set animation length and quality» → MP4; «Veo 3.1 and Grok Imagine support length control»; First & Last Frame; советы «Match camera movement to spatial type», «Prompt specifically» — https://blog.chaos.com/ai-architecture-animation
- Факт: Veras 4.6 (09.07.2026): Veo 3.1 (до 4K) / Veo 3.1 Fast / Veo 3.1 Lite (1080p), 4/6/8 с, native audio + «No audio» тумблер, first+last frame — https://blog.chaos.com/veras-4.6-veo-3.1
- Факт: Veras 4.7 (29.07.2026): Gemini Omni — video-to-video «keeping the original's motion and camera», 10 с 720p preview, до 4 reference-картинок, стоимость кредитов показана в дропдауне — https://blog.chaos.com/veras-4.7
- Факт: «Twelve [video] presets» и Render Engine 7 на Nano Banana Pro — https://architosh.com/2026/03/chaos-delivers-major-product-line-updates/
- Факт: общий пул кредитов на картинки и видео: Starter 500 кр ≈ 50 видео, Pro 2000 ≈ 200, Ultra 6000 ≈ 600 — https://www.chaos.com/veras
- Вывод: ~10 кредитов/видео; ставка на Google-стек (Veo + Gemini + Nano Banana). Позиционирование не «сохраняем дизайн», а «cinematic story». Никакого lock-тумблера.

### Rendair AI
- Факт: 5-секундные «looping animations», MP4, вход JPG/PNG/WEBP/HEIC до 16 МБ, «not intended for long-form walkthroughs», «Occasional artifacts or unexpected movements may occur», видео обходит общую очередь — https://rendair.ai/faq/can-i-generate-videos-with-rendair-ai
- Факт: пресеты Pan (L/R), Zoom (Dolly In/Out), Tilt (up/down), Drone Shot, Wide Shot («subtle establishing motion for large interior spaces»); Optional End Frame; текстовое описание движения — https://rendair.ai/faq/can-i-control-camera-movement-in-videos
- Факт: Video Tool живёт в чат-интерфейсе; для картинок используют Nano Banana Pro — https://rendair.ai/blog/3d-model-to-cinematic-video
- Факт: Starter $19 / 500 кр / 25 видео; Pro $49 / 1500 / 75; Studio $190 / 7500 / 375 — https://rendair.ai/pricing
- Вывод: 20 кредитов за видео (~$0.76). Модель не раскрыта.

### ArchiVinci
- Факт: отдельный инструмент; Camera movement: Pan / Tilt / Zoom in / Zoom out / None + направление ←→↑↓; Start Frame или Start & End Frames; prompt + negative prompt; 10 с; вход до 5 МБ; качество Normal 5 / High 10 / Best 20 монет; «about 10 mins»; заявка «preserve materials, textures, lighting, and architectural details» — https://www.archivinci.com/architecture-ai-tools/ai-image-to-video
- Факт: видео — отдельный «coin» модуль поверх подписки; 125 монет $40, 500 — $125; Monthly $79 включает 40 монет — https://www.archivinci.com/pricing
- Вывод: 5 МБ лимит и 10-минутная очередь — слабые места; UI похож на Kling'овский (стрелки направления).

### mnml.ai Video AI
- Факт: движения «static, pan, zoom in, zoom out, orbit, dolly — so the motion is a decision rather than a surprise»; optional end image («the clip morphs from your first image to it — for the same credits»); ambient sound «quiet room tone… no music or voice-over»; ~10 с; движки Flash 768p v2.0 / Cinematic 1080p; промпт до 4000 симв.; Flash = 100 кредитов — https://mnml.ai/app/video-ai и https://mnml.ai/ai-architecture-video-generator
- Факт: Lite $29 / 1000 кр / 10 видео; Plus $49 / 3000 / 30; Studio $119 / 10000 / 100 — https://mnml.ai/pricing
- Вывод: единственный, кто явно выделил **«static»** как пресет (камера стоит, живёт только свет/воздух) и добавил room-tone аудио.

### MyArchitectAI Animations
- Факт: «1. Add your render 2. Pick a camera preset 3. Animate»; названные пресеты Aerial Reveal, Furnish, Living Space, Day to Night, Assemble, Glide; «30+ presets»; «94s average time from render to video» — https://www.myarchitectai.com/animations
- Факт: Starter $29 — без анимаций; Studio $49 — 50 анимаций/мес; Team $99 — 200/мес — https://www.myarchitectai.com/pricing
- Вывод: пресеты «Furnish», «Assemble», «Day to Night» — это **не** camera-only, они меняют сцену; т.е. подход «эффекты», а не «честная камера».

### Spacely AI
- Факт: в каталоге инструментов есть «Image to Video — Create an 8-second architectural video from one or two frames», Beta, категория post-process — https://www.spacely.ai/tools
- Факт: обзор Rendershop (июль 2026) утверждает «no AI video walkthroughs» у Spacely — устарело/неверно — https://rendershop.ai/spacely-ai-review
- Факт: бывший spacelyapp.com теперь редиректит на **TwoFrame.ai** (отдельный продукт, см. ниже).
- Вывод: фича свежая, документации нет; стоимость в кредитах не опубликована.

### Homestyler AI Animator
- Факт: релиз 30.06.2026: «select images from an album or upload… growth, scene transformation, and renovation-process animations with one click» — https://www.homestyler.com/about/updates
- Факт: туториал: 7 шаблонов (Growth, Build, Time-lapse, Storyboard, Walkthrough, Furniture Display, Seasonal Shift) + «None» для кастома с opening+ending frame; авто-промпт; 16:9/9:16/1:1; 720p/1080p; слайдер длительности; ~5 мин; формула промпта «[Subject] + [Motion] + [Camera/Style]»; запрет на реальных людей — https://www.homestyler.com/forum/view/2061256931304689665
- Факт: «AI Animator: 10 credits/sec (720p); 12 credits/sec (1080p)» — https://www.homestyler.com/pricing
- Вывод: посекундная тарификация — редкость; большая часть шаблонов меняет сцену (grow/renovation), «Walkthrough» — единственный камера-only.

### Interior AI (Pieter Levels)
- Факт: «Turn any AI interior design you rendered… into a 3d flythrough video» на **Stable Video Diffusion** (launch partner); отдельно «Walk inside your interior designs in 3D» на **World Labs** (WASD-навигация) — https://interiorai.com/
- Факт: Levels собрал свой Gaussian-splat viewer, сплаты «generated from your interior with the World Labs API», 24.02.2026 — https://levels.io/built-gaussian-splat-viewer-for-interior-ai
- Вывод: SVD без управления камерой — устаревший стек для видео; реальная ценность — сплаты. Жалоб на видео на Product Hunt не найдено (там обсуждают отмену триала) — https://www.producthunt.com/products/interiorai

### Fenestra
- Факт: пресеты «Orbit, push-in, pan, dolly or flythrough» или описание; start/end frame «where supported»; ключевая фраза **«Nothing is redrawn between… the building at the end is the building you started with»**; несколько моделей на выбор, цена показана перед запуском; $8–48/мес, 200–2000 кр — https://www.fenestra.app/solutions/ai-architectural-animation-generator
- Факт (третья сторона): «integrated Seedance 2.0… 720p» — https://learnarchitecture.net/artificial-intelligence/33845-ai-video-generation-tools.html
- Факт: первым интегрировал Marble; Marble Mini ~30 с, Marble Plus 5–10 мин генерации — https://www.fenestra.app/blog/image-to-spatial-worlds-marble
- Вывод: ближайший аналог того, что хочет основатель: fidelity-позиционирование + сплаты рядом.

### Archome AI
- Факт: Zoom In/Out, Pan L/R, Dolly In, Orbit, Auto; 5/10 с; 16:9/9:16/1:1; тиры «720p · Kling 1.6», «1080p · Seedance Pro», «Veo 3 · Flow-tier»; промпт до 2000 симв. — https://archome.ai/tools/video
- Факт: «Video (5–10s) 50-400 cr»; 500 кр = $15 — https://archome.ai/pricing
- Вывод: честно показывает модель в селекторе качества — редкость.

### PromeAI
- Факт: лендинг «Architecture Render to Video»: pan/tilt/zoom/walkthrough, до 4K, батч до 10 рендеров — https://www.promeai.pro/image-to-video/architecture-render-to-video
- Факт: модели в селекторе: Wan 3.0 Pro/Prime («camera-controlled video»), Seedance 2.5/2.0/1.5, MiniMax H3, LTX 2.3, Happy Horse 1.x; 480p–4K; 16–200+ монет — https://www.promeai.pro/image-to-video
- Вывод: чистый мульти-модельный агрегатор с архвиз-лендингом; настоящий camera control только у Wan.

### Vizcom
- Факт: Animate-блок: Turntable 360°, Zoom, Pan, Tilt; Start only / Start+End; Standard vs Turbo — https://docs.vizcom.com/animating-in-vizcom
- Факт: доступен всем с 20.11.2025 — https://vizcom.com/updates
- Вывод: продуктовый дизайн, для интерьера вторично.

### LookX
- Факт: «Video Generation (new): Generate video based on image or text» — без деталей — https://www.lookx.ai/ ; в прайсе X-points за видео не указаны — https://www.lookx.ai/price.html

### Krea
- Факт: 40+ моделей, Start/End image, Duration, Resolution 720p/1080p, Aspect — https://www.krea.ai/docs/user-guide/features/video
- Факт: community-app «Walk-through video» требует **4 рендера одного пространства** в правильном порядке + текстовые команды «dolly forward, pan left, match cut» — https://www.krea.ai/nodes/app/spaciousdetachabledeer/walk-through-video
- Вывод: идея «несколько ракурсов → связный прогон» — интересна для Dizzit (у вас уже есть camera views).

### Прочие мелкие
ZSky (3–5 с, 1080p, 5 промпт-шаблонов вкл. «Interior Walkthrough», free/$19) — https://zsky.ai/ai-3d-render-to-video ; Rendore (Room reveal/Panoramic sweep/Detail showcase/Tracking shot, 4–8 с) — https://www.rendore.com/architectural-animation ; MeltFlex (Veo 3.1 Fast, 4/8 с, пресеты Cinematic/Smooth Pan/Dolly Zoom/Orbit/First Person, «correct parallax») — https://www.meltflexai.com/video-walkthrough ; home-design.ai (4/6/8 с, 720p/1080p, 16 кр) — https://home-design.ai/animate ; Ideal.house (Flash, 5/10 с, 480–1080p, 40 кр, «depth-mapping») — https://ideal.house/create/imageToVideo ; Rendershop («Describe the camera movement», FAQ без ответов) — https://rendershop.ai/product/video ; Collov AI — блог-анонсы image-to-video есть, сайт video.collov.ai недоступен (вывод: фича заброшена) — https://collovai.medium.com/crafting-the-future-of-interior-design-with-collov-ais-video-generator-2b2e0215887d ; Renderforest — общий i2v на Veo 3.1/Kling 3.0/Seedance 2.5, не архвиз — https://www.renderforest.com/image-to-video-ai

## Негенеративный / гибридный путь (ради fidelity)

- **World Labs Marble**: вход text / single image / multi-image / 360 / video; выход Gaussian splat, mesh, **видео «with pixel-accurate camera control»** — https://www.worldlabs.ai/blog/marble-world-model ; API 21.01.2026 — https://www.worldlabs.ai/blog/announcing-the-world-api ; цена 1500 кр за мир (Marble 1.1), draft 150 кр, $1 = 1250 кр → ~$1.20/мир — https://docs.worldlabs.ai/api/pricing ; кейс архитектуры/интерьеров (Fenestra) — https://www.worldlabs.ai/case-studies/2-architecture-design. Вывод: сплат «дорисовывает» скрытые области — исходный вид сохраняется, остальное генеративно; Fenestra/Interior AI/home-design.ai уже сидят на этом API.
- **home-design.ai «3D Showroom»**: одна картинка → 360°-мир; Mini 5 кр/~60 с, Plus 15 кр/~300 с — https://home-design.ai/3d-showroom (вывод: это Marble Mini/Plus под капотом — совпадают имена и тайминги).
- **InteriorAID**: «explorable 3D scene from a single image using Gaussian Splatting» + видео — https://interioraid.app/
- **TwoFrame** (ex-Spacely app): два кадра одного помещения → «solves the depth of the room and generates every frame between… real parallax… keeps geometry, light and perspective honest»; 6 пресетов; 3–15 с; 0.7 кр/с 1080p → ~$1 за 5 с — https://twoframe.ai/ , https://twoframe.ai/pricing. Вывод: модель не раскрыта; скорее всего first/last-frame генерация (Kling/Veo) с депт-маркетингом, а не реконструкция.
- **Immersity AI (ex-LeiaPix)**: depth-map → параллакс; пресеты Vertical, Zoom Right/Center/Left, Dolly, Zoom, Perspective, Circle, Horizontal; $4.99/$24.99/$49.99 — https://immersity.ai/for-web. Артефакты на краях/окклюзиях — https://www.therundown.ai/tools/immersity-ai
- **DepthFlow** (open source, ComfyUI-ноды): zoom/dolly/circle/horizontal/vertical, до 8K — https://github.com/BrokenSource/DepthFlow , https://github.com/akatz-ai/ComfyUI-Depthflow-Nodes
- **Apple SHARP** (ml-sharp, 2026): одна фотография → 3DGS «in less than a second», metric scale, «photorealistic for nearby views» — https://github.com/apple/ml-sharp. Вывод: идеальный кандидат для «маленький орбит/долли без изменения интерьера», лицензия модели — проверять.
- **Kling Motion Control**: static brush на фон «to prevent unwanted camera shifts»; Camera Control: horizontal/vertical/zoom/pan/tilt/roll + 4 Master Shots — https://kling.ai/quickstart/ai-camera-control-guide ; Wan 2.2 Fun Camera Control (Pan/Zoom/комбинации, ComfyUI) — https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-camera ; Luma Camera Motion Concepts (Orbit Right, Pedestal Up, Pull Out + Tilt Down…) совместимы с i2v и keyframes — https://lumalabs.ai/news/camera-motion-concepts

## Видео нет (проверено)
Coohom — только рендер видео из 3D-сцены/360/720° VR (https://www.coohom.com/helpcenter/10-tips-for-generate-image-videos-in-coohom?hl=en); Planner 5D — 360 Walkthrough из 3D за ~30 мин (https://support.planner5d.com/en/articles/10581383-360-walkthrough-feature); D5 Render 3.0 — нет, есть запрос на форуме 06.07.2026 (https://forum.d5render.com/t/ai-video-rendering/74861); Enscape/Envision — классические camera paths в 3D, i2v только через Veras; Arko AI; Maket.ai; RoomGPT; Reroom; Decor8; Paintit; Hestya; REimagineHome (только маркетинговое «TV»); Spline/Luma Genie — 3D-объекты, не сцены; HomeDesigns AI — «video walkthrough» упоминается в обзорах, в официальных доках не найдено.

## Жалобы на дрейф сцены
- «Kling… drifting the camera further than briefed or introducing subtle "wind" that ripples a render like fabric»; «a vertical glazing mullion… can pick up a slow bow»; Runway 8/10, Kling 6/10, Pika 5/10 по стабильности геометрии; «marble turning to soup» — https://visiomake.com/en/blog/runway-vs-kling-vs-pika-architecture-renders
- «Columns, window mullions, and structural grids can warp or drift during camera movement»; temporal coherence — главный дифференциатор — https://learnarchitecture.net/artificial-intelligence/33845-ai-video-generation-tools.html
- Про общие генераторы: «walls bend, furniture morphs, and spatial proportions feel wrong» — https://www.meltflexai.com/blog/ai-video-generator-interior-design
- Причины провалов: захламлённый/низкоразрешённый исходник, зеркала и стекло, движение против перспективы; совет «The most realistic AI walkthrough videos are usually the most restrained» — https://visiomake.com/en/blog/ai-architecture-walkthrough-video-from-still-renders-2026
- Сами вендоры пишут дисклеймеры: Rendair «Occasional artifacts or unexpected movements may occur».

## Паттерны

**Что делают все одинаково**
- Отдельная страница/таб «Video», вход — одна картинка (иногда + end-frame), 5–10 с, MP4, 16:9 (иногда 9:16/1:1), 720p/1080p.
- Набор из 5–8 пресетов: pan L/R, tilt, zoom/dolly in/out, orbit, «flythrough/walkthrough», плюс свободный промпт. Пресет = скрытый промпт-шаблон для сторонней модели.
- Тарификация кредитами, ~$1–3 за клип, квота «N видео в месяц» в тарифе. Никто не объявляет цену за секунду, кроме Homestyler и TwoFrame.
- Модель не раскрывают (Rendair, ArchiVinci, mnml, MyArchitectAI, Spacely); раскрывают только агрегаторы (PromeAI, Krea, Archome) и Chaos (Veo).
- Дисклеймер «AI может добавить неожиданное движение» вместо гарантии неизменности.

**Что различается**
- Тиры качества = разные модели (Archome: Kling 1.6 → Seedance Pro → Veo 3; mnml: Flash/Cinematic; ArchiVinci: Normal/High/Best).
- «Сюжетные» пресеты, меняющие сцену (MyArchitectAI Furnish/Assemble/Day to Night; Homestyler Growth/Renovation; Veras weather/time of day) — vs чисто камерные (mnml, Rendair, Fenestra).
- End-frame как основной вход (TwoFrame — обязателен; Krea walk-through — 4 кадра) vs опциональный.
- Аудио: mnml (room tone), Veo-сервисы (native audio с тумблером), остальные без.
- Только mnml даёт пресет «Static» (камера стоит).

**Чего никто не делает (окно для Dizzit)**
1. **Тумблер «Заморозить интерьер» с реальной механикой**, а не промптом: например, депт/сплат-реконструкция (SHARP/Marble) → рендер траектории камеры → опциональный генеративный «полиш» только на диз-окклюзиях. Ближайший — TwoFrame (маркетинг «geometry honest», механика не раскрыта) и Fenestra («Nothing is redrawn» только при start+end).
2. **Проверка результата на дрейф**: никто не показывает «diff» первого/последнего кадра с исходником или метрику «сцена сохранена на N %».
3. **Связка с уже имеющимися camera views**: у Dizzit есть генерация ракурсов — их можно использовать как start/end frames (как Krea walk-through с 4 кадрами), чтобы модель интерполировала между двумя *согласованными* видами одного интерьера, а не выдумывала выход из кадра.
4. **Ограничение амплитуды**: ни у кого нет слайдера «motion strength / travel distance» для интерьера (в 2.5D-инструментах — Immersity «Amount of Motion» — есть). Маленькая амплитуда = меньше дрейфа; это дешёвый и понятный контроль.
5. Честное указание модели и цены за секунду до запуска (делает только Veras 4.7 и Fenestra в дропдауне).

**Технические выводы для реализации (оценки):** для «камера двигается, интерьер не меняется» оптимально: (а) Veo 3.1 / Kling 3.0 с first+last frame из двух согласованных ракурсов + короткая амплитуда; (б) параллельный «геометрический» режим на SHARP/Marble-сплатах для орбит/долли на 10–20° без генеративного риска; (в) камера-пресеты для интерьера ограничить: dolly in/out, pan L/R, orbit lite, pedestal — без drone/flythrough, которые провоцируют дорисовку.

---

# Часть 2. Real-estate-инструменты, UI-паттерны и практика архвиз-комьюнити

Ограничение: Reddit и X недоступны из среды исследования, поэтому «первые руки» взяты из YouTube-описаний, блогов archviz-практиков (Chaos CGconnect, RebusFarm, AI Fire) и вендорских гайдов с конкретными настройками.

## (a) Real-estate-инструменты с фото→видео

| Инструмент | Как устроен поток | Движок | Цена | Обещание «комната не меняется» / известные проблемы | Источник |
|---|---|---|---|---|---|
| **Pixlmob AI Clips** (маркетплейс для RE-фотографов) | Загрузка фото → выбор движения из пресетов **Truck (left/right), Dolly (in/out), Push in, Pull back, Orbit left/right** или **«Auto»** → клип **3 с, «boomeranged to 6 seconds»**, 1080p; ручная проверка командой; ≈1 час | Не раскрыт [Ф] | $1.60/клип, объёмом до $0.96 | «camera move preferences are a guide, not a guarantee… If your preference risks a lower-quality result, the model will adjust». Запрет: фото с **текстом, людьми, коллажами**. Бумеранг [В] — способ спрятать накопленный дрейф на конце клипа | https://www.pixlmob.com/ai-clips , https://intercom.help/pixlmob/en/articles/10589582-introducing-ai-clips |
| **Reel-E** | 5–40 фото → «unique camera paths per photo», **3–5 с на фото**; правило: «A long hallway gets a forward dolly. A wide living room gets a lateral slide. A detailed kitchen gets a slow orbit» | «custom AI inference stack (not off-the-shelf Google Veo or Kling models)» [Ф — заявление вендора]; «creates depth from flat images… real 3D camera paths» → [В] depth-based 2.5D-параллакс | $44/мес, $97–129 Growth, $599 Pro (4K) | Артефакты названы прямо: «A window reflection that distorts. A doorframe that bends slightly. A floor that appears to ripple»; зеркала — «treating the reflected space as real space»; текст «will warp». Статистика: «early 2025, maybe 3 out of 10 photos produced noticeable issues. In early 2026, it is closer to 1 in 15». Требования к входу: мин. 1920×1080, реком. 3000×2000, резкость по углам, 16–24 мм | https://www.reel-e.ai/photo-to-video-real-estate , https://www.reel-e.ai/blog/ai-real-estate-video-guide |
| **ListingAI** | Пофотный выбор режима: **«Standard Motion» — «Clean static, pan, zoom, and sweep scenes» (безлимит)** vs **«Cinematic AI Motion» — «Dimensional AI camera movement» (1 кредит/сцена)**; можно смешивать; 16:9/9:16/4:5/1:1 | Не раскрыт | Free 3 кредита; $19 — 5 сцен/мес; $36 — 25; $150 — 75 | Обещаний по геометрии нет | https://www.listingai.co/features/listing-images-to-video , https://www.listingai.co/pricing |
| **Stager AI (Stager Video + API)** | API `/v1/video/generate`: `engine: "cinematic_tour_v2"`, `dynamic_panning: true`, `duration_per_slide: 4.5`, `resolution: "1080p"`; «60FPS Smooth 3D Motion», ~90 с рендер | «analyzing depth… mapping 3D motion» [Ф] → [В] 2.5D-параллакс | **$0.15 за HD-секунду** | Нет | https://stagerai.com/real-estate-ai-video-from-photos-api |
| **PhotoAIVideo** (CloudPano) | Авто-«camera movements, transitions» | Не раскрыт | $37.50/мес (52 видео/год) | Отзыв G2: «Great Video Quality, But Support and Reliability Need Improvement» | https://www.photoaivideo.com/real-estate-photo-to-video-ai |
| **AutoReel** | Каждое фото → **3-секундный клип**, 15–20 фото, 10–15 мин | «custom AI models»; конкурент: «output looks identical to Google Veo and Kling», «Interior motion quality is noticeably weaker than exteriors» | ~$29–49/мес | Нет | https://www.autoreelapp.com/ |
| **BetterSpace** | Фото или ссылка на листинг → авто-видео | Не раскрыт | Free 2 видео/мес; от $29/мес | Нет | https://www.betterspace.ai/ai-real-estate-video |
| **Amplifiles** | AI-движение на каждое фото; «floor plans… look awkward in video» | Не раскрыт | $1.50/фото | Нет | https://www.amplifiles.ai/blog/real-estate-photos-to-video-ai |
| **Styldod / Apply Design / Canva / Luma RE-лендинги** | слайдшоу или общий I2V без пресетов | — | — | Нет | — |
| **Virtual Staging AI, BoxBrownie, REimagineHome, Autoenhance.ai, Restb.ai, HouseCanary, Matterport/Zillow** | **Фото→видео нет** [Ф] | — | — | — | — |

**Ближайшие интерьерные сервисы с I2V, не попавшие в часть 1:** MeltFlex (Veo 3.1 Fast, 4/8 с, «straight lines stay straight and furniture keeps its shape as the camera moves», €7.99/300 кр) — https://www.meltflexai.com/blog/ai-video-generator-interior-design ; Ideal House (промпт «slow pan across the kitchen», 5/10 с, 480–1080p, 40 кредитов) — https://ideal.house/create/imageToVideo ; Visiomake (пресеты push-in/pan/orbit + «reduce the motion intensity», тест-клип 3–6 с) — https://visiomake.com/en/blog/ai-architecture-walkthrough-video-from-still-renders-2026

**Регуляторика [Ф]:** California AB 723 с 01.01.2026 — раскрытие цифрово изменённых фото листинга + ссылка на оригинал; формулировка Reel-E: «Video created from listing photos using AI motion technology».

## (b) Как UI выражают силу движения и камеру (дословно)

| Продукт | Камера — дословно | «Сила/мало движения» | Статика | Источник |
|---|---|---|---|---|
| **Higgsfield (DoP)** | Static, Dolly In/Out/Left/Right, Super Dolly In/Out, Pan L/R, Tilt Up/Down, Crane Up/Down, 360 Orbit, Arc L/R, Zoom In/Out, Crash Zoom, Dolly Zoom, Handheld, Lazy Susan, Whip Pan, FPV Drone… (50+) | Сила = выбор пресета; слайдера нет; в API `motion_strength` 0–1 («0.3 для тонкого») | «Static» | https://higgsfield.ai/camera-controls |
| **Runway Gen-3 Alpha Turbo Camera Control** (снят 30.07.2026) | Horizontal, Vertical, Pan, Tilt, Zoom, Roll | «direction and intensity»; 0.1–1 «gentle», 4–6 «noticeable», 7–10 «intense» | всё на 0 | https://www.maginative.com/article/runway-adds-precise-camera-controls-to-gen-3-alpha-turbo/ |
| **Runway Gen-4 / 4.5** | Только промпт: push in, pull back, orbit, track… | «pair it with a speed modifier like 'slow' or a duration like '5-second pan right'» | **«locked camera» / «the camera remains completely still»**; «no camera movement» даёт обратный эффект | https://runway.com/resources/ai-camera-prompts |
| **Luma Dream Machine** | Camera Motion Concepts: Static, Orbit L/R, Pull out, Push in, Pedestal up/down, Pan, Tilt, Truck, Roll, Zoom, Crane, Elevator… | Нет слайдера; API `loop: true`, `frame0/frame1` | «Static»; Loop | https://lumalabs.ai/learning-hub/how-to-use-camera-motion , https://docs.lumalabs.ai/docs/video-generation |
| **Kling Camera Movement panel** (≤2.x) | horizontal, vertical, zoom, pan, tilt, roll + 4 Master Shots | API `camera_control.config.*` **−10…10**, для `simple` одно поле ненулевое | **Static Brush**: «fix pixels in the brushed areas» | https://kling.ai/quickstart/ai-camera-control-guide |
| **Kling VIDEO 3.0 / Omni** | Панели нет — промпт + Multi-Shot; Start & End Frames | «Slow, stable pan left across [scene], no sudden motion» | «Static camera» | https://kling.ai/quickstart/klingai-video-3-model-user-guide |
| **Hailuo Director** | `[Truck left/right], [Pan left/right], [Push in/Pull out], [Pedestal up/down], [Tilt up/down], [Zoom in/out], [Shake], [Tracking shot], [Static shot]`; до 3 в одном промпте | Нет числовой силы | `[Static shot]` | https://platform.minimax.io/docs/api-reference/video-generation-i2v |
| **Midjourney Video** | Animate → Auto / Manual; **Low motion / High motion**; `--motion low|high`, `--loop`, `--end` | Low: «better for ambient scenes where the camera stays mostly still» | Low по умолчанию | https://updates.midjourney.com/introducing-our-v1-video-model/ |
| **Leonardo Motion 2.0** | Dolly in/out, Pan L/R, Zoom in/out, Orbit, Tilt, Tracking; API 27 `elements` с `weight` −2…2 | **«Motion Strength» 1–10**: «3-5 subtle», «8-10 significant, often distorted» | низкий strength | https://intercom.help/leonardo-ai/en/articles/11027827-generating-video-on-leonardo-ai |
| **Adobe Firefly Video** | Camera motion: zoom in/out, move right/left, pan L/R, tilt up/down, handheld, **static**; Shot size; Camera angle | «Leave on **None** and the model decides» | «static» | https://helpx.adobe.com/firefly/mobile/work-with-audio-and-video/work-with-video/use-motion-presets-for-video-generation.html |
| **Freepik AI Video** | Effects: Static, Move L/R/Up/Down, Pan, Push In/Pull Out, Zoom, Orbit, Crane | Нет слайдера | «Static» | https://filmart.ai/freepik-ai-video-generator-guide/ |
| **Krea** | Aspect, Duration 6/12 s, Resolution, Start/End image; узел «Motion»: сегментация + параллакс фона | параллакс детерминированный | — | https://www.krea.ai/docs/user-guide/features/video |
| **Vidu Q2/Q3** | — | `movement_amplitude: auto|small|medium|large` | — | https://platform.vidu.com/docs/image-to-video |
| **Seedance 2.0** | Промптом: «slow forward dolly», «gentle orbit», «locked camera with subtle environmental motion»; `--camerafixed` | слова «slow/gentle» | «locked camera» | https://www.rundiffusion.com/seedance-2-0-for-architecture |

**Закономерность [В]:** ни один массовый I2V-продукт не даёт числовой «силы камеры», кроме Kling API ≤2.x (−10…10), Runway Gen-3 (снят) и Leonardo (1–10). Остальные сводят к пресет-словарю, бинарнику low/high и «Static/None».

## (c) Дайджест практиков

### Что ломается на интерьерах
- **Стены/дверные проёмы гнутся**, «floating furniture», «bending lines» при быстром или составном движении — https://videoai.me/blog/kling-ai-troubleshooting
- **Окна/зеркала/стекло**: «Flickering glazing/reflections»; Runway — шиммер на мраморе и стекле; Kling — мулльоны «develop a slow bow», «drifting the camera further than briefed»; Pika — «Floor edges wobble during a dolly» — https://visiomake.com/en/blog/runway-vs-kling-vs-pika-architecture-renders
- Reel-E: отражение в окне искажается, дверная рама гнётся, пол «ripples»; зеркала трактуются как реальное пространство; текст «warps».
- «Furniture or doors appear that are not in the photo»; «looks like a video game, not a photo» — https://www.meltflexai.com/blog/kling-ai-real-estate
- «Vertical lines must stay vertical»; «Parallax must be calibrated»; «Lighting kelvin must stay coherent» — https://aivideobootcamp.com/blog/ai-video-tours-real-estate-kling-veo-seedance/
- Veo 3.1 «hallucinated a completely different interior scene» на простом dolly-in, Kling 3.0 «executed it flawlessly» (один тест) — https://www.elser.ai/blog/kling-ai-vs-veo-2026
- Luma Ray3.2: «background elements… sometimes shift between the reference and the output»; Kling 3.0 — «relatively low drift» — https://www.atlascloud.ai/blog/guides/kling-ai-vs-runway-vs-luma

### Настройки, которые работают
- **Одно движение на клип**: «One slow move per shot, stop there»; «Two moves in one prompt produces a confused result» — https://videoai.me/blog/kling-ai-camera-movement-prompts
- **Скорость**: «5 seconds for full travel»; «Too fast and Kling produces warping. Too slow and there is no visible motion»; «A dolly without foreground, midground and background elements becomes a zoom».
- **Длительность**: «5 seconds for interior shots (less time for drift to accumulate)»; Runway «keep the move slow and under eight seconds».
- **Промпт Kling**: «slow dolly forward through the front entry into a bright open-plan living room, eye-level, gimbal smooth, warm natural daylight, photorealistic. Negative: blur, distort, low quality, people, text, watermark, camera shake».
- **Промпт Runway**: «Slow steady dolly forward through the doorway, camera at chest height… Locked horizon, no camera shake, no people».
- **Негативы для интерьера**: «warping walls, floating furniture, geometric distortion, bending lines, double windows»; «SOURCE LOCK: Preserve … exactly — camera movement, composition, timing and every object's position» — https://boardspace.ai/video-prompt-guide/
- **Фиксация геометрии словами**: «keep the room exactly as shown, do not add or change any furniture»; «photorealistic, real estate photography look» вместо «cinematic/epic». Официальный Kling: «fixed lens», «tripod», «35mm» «ground spatial physics and prevent camera drift» — https://kling.ai/blog/fix-ai-video-drift-consistency-guide
- **Статика**: писать «locked camera», не «no camera movement».

### Обходы
1. **Start + End frame из двух рендеров** — главный приём archviz 2025–26: Max Anh (AI Fire, 23.01.2026) — камера в 3ds Max/Blender, кадры 0 и 300, Kling «First & Last Frame», сначала 5 с, длинные — сегменты с общими кадрами; проваливаются «Complex spiral camera moves», «Extreme close-ups of textures» — https://www.aifire.co/p/ai-vs-render-farm-professional-archviz-workflow-2026 ; Ricardo Eloy (Chaos CGconnect) — https://cgconnect.chaos.com/insights/articles/34c81679-bringing-your-archviz-to-life ; renderdrop «Start/End Frames to keep walls straight» — https://www.youtube.com/watch?v=1A7uOdk9Sng ; Nuno Silva «Locked camera animation without jitter» — https://www.youtube.com/watch?v=eU0mDLGw3WA ; Market U «Generate in overlapping pairs → image 1+2, then 2+3» — https://www.youtube.com/watch?v=ReASV_e1mwc ; «Set both start and end frames from same photo» против морфинга — MeltFlex.
2. **Короткие клипы + склейка**: тур 15–30 с из 5-секундок; «a series of controlled shots almost always looks more polished».
3. **Подготовка входа**: апскейл и чистка рендера; убрать «distractions that confuse depth perception»; ≥1920×1080, лучше 3000×2000; без людей/текста; «be careful with large mirrors and windows».
4. **Апскейл после**: Topaz Astra / Starlight — https://www.topazlabs.com/tools/kling-video-upscaler
5. **Стабилизация в редакторе** вместо перегенерации — Runway.
6. **2.5D-параллакс по глубине** (DepthFlow / Immersity / Krea Motion) — детерминированно; [В] так устроены Stager AI и, вероятно, Reel-E — отсюда низкий брак.
7. **Выбор модели по клипу** (AVB, апрель 2026): Kling 3.0 Pro для 5–10 с интерьерных «reveals»; Seedance 2.0 — «longest single takes (15 seconds) with the highest motion stability»; Veo 3.1 — start-to-end для пусто→обставлено.

## (d) 10 выводов для продукта

1. **Два уровня движения по механизму** (как ListingAI): «Стандарт» = детерминированный 2.5D-параллакс (дёшево, интерьер не меняется), «Кино» = генеративный клип за кредиты.
2. **Словарь пресетов вместо промпта**: Static, Push In / Pull Out, Pan L/R, Tilt Up/Down, Truck L/R, Crane Up/Down, Orbit L/R. Для интерьеров оставить медленные: push-in, pull-out, truck, orbit lite, tilt-up.
3. **«Авто» как первый вариант** с правилом по композиции (коридор → forward dolly; широкая гостиная → lateral slide; кухня → slow orbit) и честным «выбор — рекомендация, не гарантия».
4. **4–6 с по умолчанию**, до 8 с максимум.
5. **Одно движение на клип** аппаратно; длинный тур = склейка + бумеранг/петля.
6. **Сила движения — 3 ступени** («едва / мягко / заметно»).
7. **Скрытый системный промпт**: «locked horizon, fixed lens, tripod, gimbal smooth, photorealistic, real estate photography look, keep the room exactly as shown, do not add or change any furniture» + негатив «warping walls, floating furniture, geometric distortion, bending lines, double windows, people, text, camera shake».
8. **Предупреждения на входе**: зеркала, большие окна, читаемый текст, люди, разрешение <1920×1080.
9. **Режим «два рендера → клип»** (start + end frame) как продвинутая функция.
10. **Раскрытие и водяной знак**: строка «Видео создано из статичного рендера с AI-движением камеры», хранить исходник.

---

# Часть 3. Технический разбор: модели, 3D-подходы, контроль качества

## 0. Главный вывод

1. **Ни один генеративный I2V-API не гарантирует неподвижность сцены.** Структурные ручки камеры сохранились у трёх моделей верхнего эшелона: **Hailuo** (команды `[Push in]`, `[Truck left]`… в промпте), **Luma Ray** (`concepts: [{key:"push_in"}]`, `loop`, `keyframes`) и **Kling ≤2.x** (`camera_control`, `static_mask`, `image_tail`) — при этом **Kling 3.0/Omni убрал `camera_control` и `cfg_scale`** [3rd, несколько зеркал]. Veo/Runway/Seedance/Wan управляют камерой только текстом.
2. **Бенчмарк WorldScore измеряет именно нашу задачу** («послушность камеры» + «3D-согласованность»): у обычных видеомоделей Camera Control 29–38 из 100 (Gen-3 — 29.47, CogVideoX-I2V — 38.27), у 3D-заземлённых методов 86–93 (WonderWorld 92.98, LucidDreamer 88.93, Voyager 85.95) [офиц. лидерборд]. SOTA по «камера двигается, сцена стоит» — **3D-заземлённые пайплайны**, а не «умный промпт».
3. Для интерьерного SaaS рационально **трёхуровневое решение**: (а) 2.5D-параллакс по глубине как мгновенный и на 100 % «недрейфующий» слой; (б) генеративный I2V с ручками камеры + автоматический QC-цикл с ретраями; (в) для orbit/walkthrough — генерация 3D-мира (Marble API ≈ $1.20/мир) и рендер камеры по сплату.

## 1. Генеративные API × ручки «сцена неподвижна»

| Модель | Start/End frame | Структурное управление камерой | Маски / «замереть» | Сила/точность | Seed / Neg.prompt | Длина / разрешение | Цена | Источник |
|---|---|---|---|---|---|---|---|---|
| **Kling 1.x–2.6** (API) | `image` + `image_tail` (pro; на fal `start_image_url`/`end_image_url`) | `camera_control: {type: simple|down_back|forward_up|right_turning_forward|left_turning_forward, config: {horizontal, vertical, pan, tilt, roll, zoom}}`, каждое поле **[-10, 10]**; при `type: simple` **только одно поле ≠ 0** [3rd] | `static_mask` (URL маски «стоять»), `dynamic_masks: [{mask, trajectories}]` [3rd] | `cfg_scale` [0,1], дефолт 0.5 | `negative_prompt` (≤2500 симв.) | 5/10 с; `mode` std/pro | fal: 2.6 Pro **$0.07/с без звука** [3rd] | AI/ML API, 1min.ai, PiAPI, fal |
| **Kling 3.0 / 3.0-Omni** | `start_image_url` + `end_image_url` (Omni — без end frame [3rd]) | **нет** `camera_control`; камера — текстом или `multi_shots` (≤6 шотов, ≤15 с) | нет | `cfg_scale` **«не используется для 3.0/3.0-omni»** [3rd] | `negative_prompt` | 3–15 с, 720p/1080p | 6/8 кред./с [3rd] | fal v3 pro, kling.ai quickstart |
| **Runway Gen-4 Turbo / Gen-4.5** | `promptImage` — **только первый кадр** [3rd] | нет параметров; только `promptText`. Панель Camera Control была у Gen-3 Alpha Turbo (**снят 30.07.2026**) | нет | нет | `seed` | 5/10 с | Gen-4.5 **$0.12/с** [3rd] | Runware, AI/ML API |
| **Luma Ray 3.2 / Ray 2** | `keyframes: {frame0, frame1}`; Ray 3.2 multi-keyframe (1–64) [офиц.] | `concepts: [{key}]` — 34 ключа: **`static, push_in, pull_out, orbit_left, orbit_right, truck_left, truck_right, pan_left, pan_right, tilt_up, tilt_down, pedestal_up, pedestal_down, crane_up, crane_down, dolly_zoom, zoom_in, zoom_out, handheld, eye_level…`** [офиц.]; для Ray 3 «Camera is controlled by language» | нет | нет | нет neg.prompt | 5/10 с; до 1080p; `loop: true` **только 5 с** [офиц.] | **$0.30/5 с 720p, $1.20/5 с 1080p** [офиц.] | docs.lumalabs.ai |
| **Google Veo 3.1** | `image` + `lastFrame`; `referenceImages` ≤3 — **несовместимы с `image`** [офиц.] | нет; словарь в промпте | нет | нет | `seed`, `negativePrompt` | 4/6/8 с; 720p/1080p (1080p и 4K — только 8 с) | **Standard $0.40/с; Fast $0.10–0.12/с; Lite $0.05–0.08** [офиц.] | ai.google.dev |
| **Seedance 2.0 / 2.5** | `image_url` + `end_image_url` (fal); в ModelArk — first_frame/last_frame [3rd] | текст-команды: **`--camerafixed true|false`**, `--seed` [3rd]; на fal 1.5 Pro — `camera_fixed: true` | нет | нет | `seed` | 2.0: 4–15 с, 480p–4k; 2.5: 4–30 с | ≈$0.26 за 5 с 720p [3rd] | fal, BytePlus |
| **Wan 2.6 / 2.7** | `media: [{type: first_frame}, {type: last_frame}]` [офиц.] | **нет** параметров камеры; `prompt_extend` (дефолт true — выключать [вывод]) | нет | нет | `seed`, `negative_prompt` ≤500 | 2–15 с; 720P/1080P | ≈ $0.15/с 1080p [3rd] | alibabacloud.com |
| **Wan2.2-Fun-Control-Camera** (open weights) | I2V | **Pan Up/Down/Left/Right, Zoom In/Out и комбинации** (ComfyUI) | — | — | — | 121 кадр; RTX 3060 12 GB [офиц.] | self-host, **Apache 2.0** | HF alibaba-pai |
| **MiniMax Hailuo 02 / 2.3 / I2V-01-Director** | `first_frame_image` | **15 команд в скобках: `[Truck left/right], [Pan left/right], [Push in], [Pull out], [Pedestal up/down], [Tilt up/down], [Zoom in/out], [Shake], [Tracking shot], [Static shot]`**; ≤3 одновременно [офиц.] | нет | `prompt_optimizer` (дефолт **true** — выключать) | нет neg.prompt | 6/10 с; до 1080P (6 с) | ≈$0.27 за 768p-6с, ≈$0.53 за 1080p-6с [расчёт] | platform.minimax.io |
| **Higgsfield DoP** (через fal/Segmind) | image | `motion_id` из **122 пресетов**, `motion_strength` 0–1 («0.3 для тонкого») [3rd] | нет | strength | seed | — | не раскрыто | Segmind |
| **Vidu Q2/Q3** | `images` (1) | **`movement_amplitude: auto|small|medium|large`** [офиц.] | нет | amplitude | `seed` | Q3 1–16 с | ≈$0.034–0.042/с [3rd] | platform.vidu.com |
| **Pika 2.2 Pikaframes** | до 5 ключевых кадров | нет | нет | — | — | до 25 с | $0.04–0.06/с [3rd] | fal |
| **LTX-2 / 2.3** (open weights + API) | I2V, keyframe | **LoRA камеры: `Camera-Control-Static`, `-Dolly-In`, `-Dolly-Out`, `-Dolly-Left`, `-Dolly-Right`** [офиц. HF] | — | — | — | до 4K, до 20 с | self-host / API | HF Lightricks |

**Следствия [вывод]:**
- Единственная «замри-маска» — Kling `static_mask`, только в ≤2.x и **взаимоисключима с `camera_control` и `image_tail`** [3rd].
- `--camerafixed`, `[Static shot]`, `static`, `Camera-Control-Static` — ручки обратной задачи («камера стоит, объекты живут»); полезны для режима «амбиент».
- Трюк «первый кадр = последний кадр» (Kling `image_tail`, Luma `frame1`, Veo `lastFrame`, Seedance `end_image_url`, Wan `last_frame`) даёт бумеранг с **гарантированным возвратом в исходную геометрию**; Luma `loop: true` — то же за один параметр.

## 2. 3D-заземлённые маршруты из одного изображения

| Подход | Что это | API / веса | Лицензия | Требования / задержка | Диапазон камеры | Зрелость |
|---|---|---|---|---|---|---|
| **DepthFlow** (2.5D) | GLSL по карте глубины; пресеты `Dolly, Zoom, Orbital, Circle, Vertical, Horizontal` [офиц.] | open-source, pypi, ComfyUI | **AGPL-3.0** | RTX 3060 — до 8K; секунды | малые сдвиги; растяжение краёв без заполнения окклюзий | production |
| **Immersity AI** | облачный 2.5D: `disparity` + `animation`; **`animationLength` 1–10, `amplitudeX/Y/Z` 0–10, `phaseX/Y/Z`, `convergence`, `numberOfLoops`** [офиц.] | REST API | платные планы $4.99–99.99/мес | секунды | как у любого 2.5D | production |
| **Depth Anything 3** | глубина + Gaussian head → 3DGS-видео | HF/GitHub | **Base/Small/Metric-Large — Apache 2.0; Giant/Large/Nested (с Gaussian head) — CC BY-NC 4.0** [офиц.] | <12 GB | небольшой | Gaussian head **не коммерческий**; как оценщик глубины — да |
| **World Labs Marble API** | image → навигируемый мир (сплат) | **`POST /marble/v1/worlds:generate`**, `model: marble-1.1 | marble-1.1-plus | marble-1.0-draft`; polling ~5 мин; выход SPZ/PLY/GLB, HQ mesh [офиц.] | **$1 = 1 250 кр; marble-1.1 = 1 500 кр ≈ $1.20; draft ≈ $0.12–0.20**; коммерческие права API-выходов уточнять | ~5 мин | полный orbit/walkthrough; вдали от исходного вида — генеративная «догадка» | production; видео по траектории рендерить самим (Three.js/Spark) |
| **Tencent HunyuanWorld 1.0 / Voyager** | panorama → mesh; Voyager — RGB-D диффузия по траектории, **WorldScore Camera Control 85.95** [офиц.] | веса | лицензия **не действует в ЕС, UK, Корее** | Voyager: 60–80 GB VRAM | большой | research |
| **NVIDIA GEN3C** | 3D-кэш → рендер по траектории → диффузия дорисовывает | HF | код Apache 2, веса NVIDIA Open Model License | ~43 GB VRAM; траектории `left, right, up, down, zoom_in, zoom_out, clockwise, counterclockwise` [офиц.] | точная камера | research, high-quality |
| **Stable Virtual Camera (SEVA)** | 13 пресетов orbit/spiral/dolly… 576p | веса | **Non-Commercial** | 1 GPU | большой | **для SaaS непригодна** |
| **ViewCrafter** | DUSt3R point cloud + видеодиффузия; 576×1024 | веса | **Apache-2.0** | 1×A100, 120 с | средний | research |
| **Uni3C** (Alibaba) | PCDController на Wan2.1 | веса | **Apache-2.0** | ~50 GB VRAM | большой | research |
| **Apple SHARP** | одна фотография → 3DGS «in less than a second», «photorealistic for nearby views» | GitHub | проверять | — | малый орбит/долли | новое, 2026 |
| **Skywork Matrix-3D** | image → панорамное видео → 3DGS | код/веса | **MIT** | ~1 час на 720p | 360° | медленно |
| **Google Genie 3** | world model | **API нет** | — | — | — | недоступно |

## 3. QC-циклы

**Существует (подтверждено):**
- **VBench** (`vbench evaluate --dimension … --mode=custom_input`): `subject_consistency` (DINO), `background_consistency` (CLIP), `motion_smoothness`, `dynamic_degree`; **VBench-I2V**: `i2v_subject`, `i2v_background` (сходство кадров с **входным изображением**), `camera_motion` (CoTracker классифицирует тип движения) — https://github.com/Vchitect/VBench
- **EvalCrafter**: warping error (RAFT-flow между соседними кадрами), CLIP-Temp — https://arxiv.org/html/2310.11440v3 ; **MAWE** (motion-aware warp error) — https://arxiv.org/pdf/2403.14773
- **WorldScore**: Camera Control, 3D Consistency, Photometric Consistency — https://haoyi-duan.github.io/WorldScore/
- **VLM-as-judge**: Google Cloud «Gemini как судья» по ключевым кадрам; open-source **Video_Gen_QC** — 16 кадров, чек-лист «фиксированные камера/фон», аномалии, JSON `pass|fail|uncertain`, любой fail → REJECT — https://github.com/K3lv1n0219/Video_Gen_QC
- **Предостережение**: VLM почти не реагируют на перемешивание кадров — слабы к мелкому мерцанию, сильны к семантическому дрейфу («появилась дверь», «три подушки») — https://arxiv.org/pdf/2505.00209

**Рекомендуемый контур [вывод]:**
1. Идентичность к исходнику: DINOv2/CLIP-сходство каждого 5-го кадра с рендером; порог по 50–100 ручным оценкам.
2. Ригидность: RAFT-flow → warp error + подгонка гомографии; большой остаток = морфинг стен/мебели.
3. Геометрия: Depth Anything 3 (Apache) → согласованность глубины через репроекцию.
4. Семантика: vision-модель с исходником + сеткой кадров и чек-листом «что появилось/исчезло/изменило форму; окна и двери на месте». Строгий JSON.
5. Ретраи: fail → другой seed; второй fail → меньше амплитуда или другое движение; третий → другой провайдер. Луп-режим снижает частоту отказов сам.

## 4. Промпт-практика

**Наблюдения по моделям [3rd, Visiomake]:** Runway — линии остаются прямыми при медленном движении, но шиммер на мраморе/стекле; Kling — лучшая глубина, но изгиб импостов и «уводит камеру дальше, чем просили»; Luma — «slow dolly in действительно даёт slow dolly in». Гигиена: апскейл и чистка до анимации, без людей и сильных отражений, 4–8 с, одно движение.

**Шаблоны:**
- Higgsfield / RE: `slow dolly forward through the front entry into a bright open-plan living room, eye-level, smooth steady gimbal motion, warm natural daylight, photorealistic`
- Hailuo: `[Push in] slow, steady camera moves toward the sofa; furniture, walls and lighting remain exactly as in the image`
- Kling негатив: `morphing, warping, distortion, background shifting, floating objects, people, text, inconsistent geometry`; фраза `maintains exact appearance throughout`
- Veo: `wide interior shot, slow dolly in, 24mm lens, natural daylight`; лок — `static camera`; негатив без «no/don't» («an unoccupied room»)
- Seedance: движение текстом + `--camerafixed false`; амбиент — `--camerafixed true`
- Luma: `concepts: [{key: "push_in"}]`, `keyframes.frame0` = рендер, `loop: true`

**Универсальный каркас [вывод]:** `<одно медленное движение> + <eye-level, 24–35mm> + "the room, furniture, materials, windows and lighting stay exactly as in the image; no people, nothing moves except the camera" + <негатив: morphing, warping, distortion, added objects, people, text, flicker>`; `prompt_optimizer`/`prompt_extend` = false, 5 с, 1080p, seed фиксировать.

## 5. Рекомендация «что выбрать для интерьеров»

**Уровень 1 — «мгновенно и без дрейфа».** 2.5D-параллакс: Depth Anything (Apache-версии) → рендер в WebGL/Three.js на клиенте. Долли/пан/лёгкий crane с **нулевым** изменением сцены. Стоимость ≈ 0. Ограничение: амплитуда единицы процентов кадра, орбиты нет. Immersity API — облачная замена за $25–100/мес.

**Уровень 2 — «кинематографично» (платно, с QC).** Hailuo 2.3 (структурные команды, ≈$0.27–0.53 за 6 с, `prompt_optimizer=false`); Luma Ray 3.2 (`concepts` + `loop` + `keyframes`, $0.30 за 5 с 720p); Kling 2.6 (fal, $0.07/с) с `end_image_url = start_image_url` для бумеранга; Kling ≤2.1 через официальный API — если нужен именно `camera_control`/`static_mask`. Veo 3.1 и Runway Gen-4.5 — премиум-запасные. Обязателен QC-контур с 2–3 ретраями.

**Уровень 3 — «прогулка/орбита» (премиум).** World Labs Marble API: image → сплат за ~5 мин и ≈$1.20; траектория и видео рендерятся самим, камера математически точна, сцена неизменна по построению. Self-host альтернативы: GEN3C, Uni3C; Voyager сильнее, но 60–80 GB и лицензия закрыта для ЕС/UK/Кореи; SEVA отпадает (non-commercial).

**Почему так:** дрейф — свойство видеодиффузии без 3D-памяти; `cfg_scale`, негативы и «slow» лишь снижают вероятность. Гарантия — либо не перерисовывать пиксели (уровень 1), либо заземлить в 3D (уровень 3). Уровень 2 нужен коммерчески, но в обёртке измеримого QC.

## 6. Источники части 3

Официальные: https://kling.ai/blog/kling-ai-camera-control-video-guide ; https://kling.ai/quickstart/klingai-video-3-model-user-guide ; https://docs.dev.runwayml.com/api/ ; https://docs.lumalabs.ai/docs/video-generation ; https://docs.lumalabs.ai/changelog/concepts ; https://docs.agents.lumalabs.ai/guides/pricing/ ; https://ai.google.dev/gemini-api/docs/veo ; https://ai.google.dev/gemini-api/docs/pricing ; https://platform.minimax.io/docs/api-reference/video-generation-i2v ; https://platform.minimax.io/docs/guides/pricing-video ; https://fal.ai/models/bytedance/seedance-2.0/image-to-video/api ; https://www.alibabacloud.com/help/en/model-studio/image-to-video-general-api-reference ; https://huggingface.co/alibaba-pai/Wan2.2-Fun-5B-Control-Camera ; https://platform.vidu.com/docs/image-to-video ; https://higgsfield.ai/camera-controls ; https://github.com/Lightricks/LTX-2 ; https://huggingface.co/Lightricks/LTX-2-19b-LoRA-Camera-Control-Static ; https://fal.ai/models/fal-ai/kling-video/v2.6/pro/image-to-video/api ; https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api ; https://docs.worldlabs.ai/api ; https://docs.worldlabs.ai/api/pricing ; https://github.com/Tencent-Hunyuan/HunyuanWorld-Voyager ; https://github.com/nv-tlabs/GEN3C ; https://github.com/Stability-ai/stable-virtual-camera ; https://github.com/Drexubery/ViewCrafter ; https://github.com/alibaba-damo-academy/Uni3C ; https://github.com/SkyworkAI/Matrix-3D ; https://github.com/apple/ml-sharp ; https://github.com/ByteDance-Seed/Depth-Anything-3 ; https://github.com/BrokenSource/DepthFlow ; https://docs-api.immersity.ai/reference/transactioncontroller_generateanimation-1 ; https://haoyi-duan.github.io/WorldScore/ ; https://github.com/Vchitect/VBench ; https://arxiv.org/html/2310.11440v3 ; https://github.com/K3lv1n0219/Video_Gen_QC

Сторонние: https://docs.aimlapi.com/api-references/video-models/kling-ai/v1-pro-image-to-video ; https://docs.1min.ai/docs/api/ai-for-video/image-to-video/kling-ai ; http://piapi.ai/docs/kling-api/create-task ; https://runware.ai/docs/en/providers/runway ; https://tutorial.theaibuilders.dev/tutorials/Image%20and%20Video/seedance_tutorial ; https://www.buildmvpfast.com/api-costs/ai-video ; https://visiomake.com/en/blog/runway-vs-kling-vs-pika-architecture-renders ; https://www.meltflexai.com/blog/higgsfield-real-estate-walkthrough-videos ; https://prompt-architects.com/blog/25-30-cinematic-camera-prompts-for-veo3-and-kling ; https://medium.com/google-cloud/how-gemini-is-closing-the-consistency-gap-in-llm-generated-video-and-image-7d0043a973b7 ; https://arxiv.org/pdf/2505.00209 ; https://biggo.com/news/202509031913_Tencent_Blocks_EU_UK_Users_AI_Regulations

**Не удалось получить напрямую:** kling.ai/document-api (JS), help.runwayml.com (403), docs.byteplus.com Seedance, docs.ltx.video (403), Reddit. Данные по ним помечены [3rd] и требуют сверки пробой перед фиксацией в коде.

---

# Часть 4. Higgsfield: продукт, модели, «3D-стадия»

Дата проверки: 18.09.2026. Пометки: **[✔]** — подтверждено первоисточником, **[~]** — вывод или сторонний источник, **[✗]** — опровергнуто.

## Краткий вывод

1. Higgsfield — не «модель», а агрегатор + оркестратор: 30+ сторонних видеомоделей в одном пикере плюс несколько собственных (DoP, Soul, Soul Cinema, Popcorn, Keyframes, Speak). Сами подтверждают: «We focus on post-training and fine-tuning rather than building entirely proprietary models» (Mashrabov, Sacra). **[✔]**
2. Названия сторонних моделей открыто показаны в UI и в прайсе (Kling 3.0, Seedance 2.5, Veo 3.1, Sora 2, Wan 3.0, Hailuo, Grok и т.д.). **[✔]**
3. «Сначала 3D, потом видео» — **в основном нет**. Обычный image-to-video (DoP, Kling, Seedance, Wan) — кондиционирование видеодиффузии пресетом камеры/промптом/силой движения. Явное 3D только в побочных местах: (a) Cinema Studio 2.0/2.5 «Create 3D scene» — из картинки строится Gaussian splat, но результат — **новая перегенерированная картинка** («3D Image Shot»), не видео; (b) 3D Jutsu / Blender-плагин — синтетическая 3D-сцена по промпту (меши Meshy/Tripo), которую «рендерит» Seedance 2.5; фото интерьера в 3D не восстанавливает; (c) Angles 2.0 / Relight — 3D-подобный UI поверх 2D-перегенерации / depth-map для света. **[✔]**
4. Для интерьеров отзывы смешанные: сторонние тесты фиксируют «выдуманную мебель, смену планировки»; практики рекомендуют медленные одиночные движения, 4–8 с, связку кадров через start/end frame (Kling O1/3.0, Wan), «stable camera, seamless transition». **[~]**

## (a) Карта продукта (сентябрь 2026)

| Продукт / фича | Что делает | Чем работает | Статус |
|---|---|---|---|
| **Video generate** | Create / Edit / Motion Control; «250+ presets» | Пикер (дословно): Seedance 2.5, Higgsfield Genjutsu, FLUX.3 Video, Kling 3.0, Kling 3.0 Turbo, Seedance 2.0 Fast, Seedance 2.0 Mini, Seedance 2.0, Higgsfield DoP, HappyHorse, Kling 3.0 Omni, Kling 2.5, Kling 2.6, Kling O1, Grok, Grok 1.5, Google Veo 3.1, Veo 3.1 Lite, Gemini Omni Flash 1.1, Google Veo 3, Sora 2, MiniMax H3 Max, MiniMax H3, Minimax Hailuo, Wan 2.5, Wan 2.6, Wan 2.7, Wan 3.0, Wan 3.0 Prime, Wan 2.2, Seedance Pro, Seedance 1.5 Pro | [✔] UI |
| **Higgsfield DoP** | Собственная I2V-модель с пресетами камеры/VFX; тиры Lite / Standard / Turbo; кадр + промпт + пресет; 3 или 5 с, 720p | Собственная; анонс 31.03.2025: «diffusion + RL», «camera control and world-modeling» | [✔] |
| **Camera Controls** | 65 пресетов движения камеры | **Мультидвижковая**: страница пресета ведёт на `model=standard` (DoP), `wan2_5_video`, `kling-v2-5-turbo` или `minimax-2.3` | [✔] 26 страниц |
| **Cinema Studio 1.0 → 4.0** | Жанр, тело камеры, объектив, свет, движения как #-теги; 4.0 до 30 с | «built on top of interchangeable video models»; 4.0 «runs on Seedance 2.5», «pick the engine per shot» | [✔] |
| ↳ **Create 3D scene** (CS 2.0/2.5) | «move the image across the three axes and choose the key frame»; выход — новый стилл «3D Image Shot» | Gaussian splat как направляющая для перегенерации картинки | [✔]/[~] |
| **Soul / Soul Cinema** | Собственная image-модель | Собственная | [✔] |
| **Angles 2.0, Shots, Zooms** | Новый ракурс из одной картинки, 3D-сфера в UI | По обзору — «Nano Banana wrapper», выход 2D | [~] |
| **Motion Control** | Перенос движения из видео | Kling 2.6 / 3.0 Motion Control | [✔] |
| **3D Jutsu** (04.09.2026) | Промпт → редактируемая 3D-сцена → «Seedance 2.5 renders your 3D take»; экспорт MP4/GLB | Meshy, Tripo, SAM 3; агент на LLM | [✔] |
| **Higgsfield for Blender** | Видео «from what you see in Blender, with Blender's own camera» | Seedance 2.5 | [✔]/[~] |
| **Relight** | «depth-mapping technology to manipulate light sources in a 3D space» | не раскрыто | [✔] |
| **Similarity Scoring** (март 2026) | Сравнение результата с исходником | — | [✔] |
| **API** (16.09.2026) | 50+ моделей, предоплата USD | Оркестрация | [✔] |

Собственные модели по странице About: Soul 2.0, Soul Cinema, Higgsfield DOP, Keyframes, Cinema Studio; «A proprietary reasoning engine orchestrates both in-house and partner models». **[✔]**

## (b) Роутинг фича → модель

| Фича | Движок |
|---|---|
| DoP | Своя: `standard` / Lite / Turbo (API: dop-lite / dop-preview / dop-turbo) |
| Camera Controls | `standard` (DoP): General, Static (2), Dolly In (2), Crane Up, 360 Orbit, FPV Drone, Zoom In, Tilt Up, Arc Left, Overhead… ; `wan2_5_video`: Static (1), Dolly In (1), Dolly Out, Bullet Time, Handheld, Pan Left…; `kling-v2-5-turbo`: Aerial Pullback; `minimax-2.3`: Timelapse Landscape |
| Cinema Studio 4.0 | Seedance 2.5 |
| 3D Jutsu → видео | Seedance 2.5; меши — Meshy, Tripo, SAM 3 |
| Motion Control | Kling 2.6 / 3.0 |
| Draw-to-Video | Veo 3 / Hailuo 02 / Seedance Pro |
| Планировщик | GPT-4.1 mini («applying camera-motion schemas»), GPT-5 |

Help-center: Seedance — «realistic human motion»; Kling — «stylized, cinematic, long-form»; Higgsfield DOP — «Apply VFX and cinematic camera control»; Wan — «strong first and last frame control». **[✔]**

## (c) Вердикт «сначала 3D, потом видео»

**Нет для основного image-to-video. Частично для побочных инструментов.**
1. DoP: API-схема — `motion_id`, `motion_strength` 0–1, `enhance_prompt`, `seed`, `image_urls`; никаких depth/mesh/trajectory. Статей, весов, патентов нет. «World-modeling» — маркетинг. **[✔]**
2. «Reasoning engine» — LLM-планировщик, не 3D-движок. **[✔]**
3. Cinema Studio «Create 3D scene»: «The tool builds a Gaussian splat version of your scene… using the splat snapshot as a guide and generating a new image» (Flesh Syntax). Сбои: «characters morphing, objects appearing that weren't there». 3D Mode есть только в CS 2.5, «NOT available in 3.0 or 3.5». **[✔]/[~]** Это 3D-превью для выбора ракурса стилла, не видео из 3D.
4. 3D Jutsu / Blender: настоящая 3D-сцена по промпту, но видео «рендерит» Seedance 2.5; реконструкции интерьера из фото нет. **[✔]**
5. Вакансия ML Researcher: «training large-scale world models» — намерение, продукта нет. **[✔]**

## (d) Управление камерой

**Пресеты Camera Controls (65):** General, Eyes In, Bullet Time, Aerial Pullback, Arc Left, BTS, Buckle Up, Car Chasing, Car Grip, Crane Down, Crane Over The Head, Crane Up, Crash Zoom In/Out, Dolly In, Dolly Left, Dolly Out, Dolly Right, Dolly Zoom In/Out, Double Dolly, Dutch Angle, Eating Zoom, Fisheye, Flying Cam Transition, Focus Change, FPV Drone, Glam, Handheld, Head Tracking, Hero Cam, Hyperlapse, Incline, Jib down/up, Lazy Susan, Low Shutter, Mouth In, Object POV, Overhead, Pan Left/Right, Rapid Zoom In/Out, Road Rush, Robo Arm, Snorricam, Static, Super Dolly In/Out, Through Object In/Out, Tilt Down/up, Timelapse Glam/Human/Landscape, Whip Pan, Wiggle, YoYo Zoom, 360 Orbit, Zoom In/Out, Arc Right, 3D Rotation. **[✔]**

**«Static»**: «The camera remains completely still, with no motion or shake» (DoP Standard). **[✔]**

**DoP**: 3 или 5 с; `motion_strength` 0–1, default 0.8, подсказка «0.3 for subtle effects»; JPEG/PNG/WebP ≤10 МБ. Слабости: искажение пропорций при высокой силе, деформация текста, слабые результаты на тёмных фото. **[~]**

**Cinema Studio 4.0 — движения как #-теги (33):** Snorricam, Robot arm, Tilt up, Rack focus, Tilt down, POV, Pan left, Crane up, Pan right, Crane down, Side tracking, Pedestal up/down, Handheld, Tracking, Drone orbit, Dolly zoom, Aerial pullback, Static shot, Bullet time, Whip pan, Slow zoom in/out, Arc left/right, Truck right/left, Dolly in/out, Slider right/left, Crush zoom, Helicopter shot — «stack several per shot, they run in order». MoveSet-стили 3.5: Classic Static, Silent Machine, One Take, Epic Scale, Intimate Observer, Impossible Camera, Documentary Snap, Raw Chaos, Dreamy Flow. **[✔]**

## (e) Цены

**Подписка (18.09.2026, годовая):** Free 0 кр; Starter $15/мес, 200 кр; Plus $39/мес, 1 000 кр; Ultra $99/мес, 3 000 кр; Team $65–79/место; Scale $150/место. «$1 = 14 credits Starter · 26 Plus · 31 Ultra · 33 Team». Unlimited-окна только в веб-UI. **[✔]**

**Кредиты за генерацию:** DoP Lite ~3 кр/3 с; Standard ~7; Turbo ~5. Kling 3.0: 720p ~7, 1080p ~8, 4K ~30 (5 с). Seedance 2.0: 720p ~22, 1080p ~45. Wan 3.0: 5 / 8.75 / 17.5. Hailuo 2.3: ~6/~10 (6 с). Veo 3.1 Fast ~11/4 с; Veo 3.1 ~29/4 с. **[✔]**

**API (console.higgsfield.ai, с 16.09.2026):** предоплата USD, минимум $5, видео за секунду: Seedance 2.5 от $0.1234/с (акция $0.0864), Seedance 2.0 $0.1407/с, **Kling 3.0 от $0.084/с (акция $0.042)**, Kling 2.6 $0.07/с, Kling 2.5 $0.042/с, Kling O1/O3 $0.084/с, Wan 3.0 Prime $0.068/с, Wan 3.0 $0.05/с, Wan 2.6/2.7 $0.1/с, MiniMax H3 $0.13/с, Hailuo 2.3 $0.0467/с, LTX 2.5 Fast $0.09/с, Grok Imagine Video 1.5 $0.08/с. Таблица «vs Fal»: Kling 3.0 Standard I2V $0.063/с против $0.126. Блог заявляет «DoP $0.125/generation», но в живом прайсе API DoP **отсутствует**. **[✔ расхождение]**

**Сторонние хосты DoP:** Segmind dop-lite $0.16, dop-turbo $0.51, dop-preview $0.70; Pixazo lite $0.135, turbo $0.416, preview $0.573; Eachlabs $0.125 / $0.406 / $0.563; WaveSpeed — снят (404); fal.ai и Replicate — нет. **[✔]**

## (f) Интерьеры и недвижимость

- Redraw (конкурент): «the AI invents furniture that doesn't exist, changes the room's layout». **[~]**
- MeltFlex: пресеты Dolly In, 360 Orbit, Crane Up, Dolly Out, Tilt Up, Static Hero; 4–8 с («longer clips drift and distort»), «Slow camera moves read as premium. Fast moves expose AI artifacts», один пресет на клип, без людей и отражений. **[~]**
- Market U (YouTube 2026): Nano Banana → Kling O1 / 3.0 через start/end frame, «Generate in overlapping pairs → image 1+2, then 2+3», промпт «The camera moves forward into the space, revealing the interior, smooth motion, stable camera, seamless blend between frames»; «Overcomplicating the prompt breaks the consistency». **[✔]**
- Curious Refuge: камера/движение DoP **3,6/10**; «Fast camera moves dissolve into noise». HitPaw: DoP 720p, при сложных камерах «defaulted to a static output»; Kling 1080p, лучше физика. Dynalord/Piclumen: «3–5x re-roll rate». Pixazo: success 79,8 %, среднее 5,8 мин. **[~]**
- Сам Higgsfield («How to avoid distortions»): «background elements are low-priority… the model fills them in based on context»; советуют «smooth, single-direction moves». **[✔]**

## (g) Что взять для Dizzit

1. **Пресет = кортеж (движок, motion id, сила, длительность)**, а не строка промпта; один «Dolly In» может жить на разных движках. **[✔ паттерн]**
2. **«Static» как пресет и безопасный дефолт**; сила 0–1 с дефолтом ниже их 0.8 (для интерьеров 0.3–0.5). **[~]**
3. **Start/end-frame цепочка (overlapping pairs)** для прохода по нескольким кадрам одной комнаты. **[~]**
4. **3D-превью только для выбора ракурса, не для рендера** — их 3D Mode честно работает как «splat-подсказка → перегенерация» (аналог наших «Ракурсов»). **[~]**
5. **Движения как #-теги в порядке применения** и MoveSet-стили. **[✔]**
6. **LLM-планировщик**: intent → структурированная схема камеры под конкретную модель. **[✔]**
7. **Цена на кнопке до подтверждения**, метаданные генерации вместе с результатом. **[✔]**
8. **Similarity Scoring** как QA: сравнение первого/последнего кадра с исходником. **[✔]**
9. Промпты: «stable camera, seamless transition», «slow dolly forward … eye-level, smooth steady gimbal motion», «preserve the original … geometry», клип 4–8 с. **[~]**

## Компания кратко

Основана в 2023 Alex Mashrabov (экс-Head of Generative AI Snap) и Yerzat Dulat (CTO). SF + Алматы. Series B $400 млн при $5.4 млрд (17.08.2026). ARR $700 млн (август 2026). Стратегия CEO: «Betting on a single model [was a mistake]… a new model ships basically every week»; «We apply reinforcement learning for our own video models». Sacra называет Wan 2.5 «proprietary» Higgsfield — это модель Alibaba **[✗]**.

---

# Часть 5. Higgsfield DoP: техника и API

Легенда: **[Ф]** — факт, **[М]** — маркетинг, **[В]** — вывод.

## 1. Что такое DoP технически

- Анонс 31.03.2025: «Introducing Higgsfield DoP I2V-01-preview… Built for professional-level camera control, world modeling, and cinematic intent». Только image-to-video. Тиры в API v2: `dop/lite | dop/turbo | dop/standard`. **[Ф]**
- Заявленная архитектура: «novel architecture that blends diffusion models with reinforcement learning»; «RL applied after diffusion, inspired by how DeepSeek trained LLMs». Ни статьи на arXiv, ни весов, ни technical report. Никаких упоминаний Plücker-эмбеддингов, camera-pose токенов, траекторий. **[М]**
- Инференс: пост AMD×TensorWave — «1280×720 with 20 inference steps»; на 1080p H100 80 GB «out-of-memory». Данные страницы camera-controls: все 175 семплов семейства `higgsfield` имеют **`steps:20, frames:81, strength:1, guide_scale:6`**. **[Ф]**
- Mashrabov (Sacra): «We play at the model layer where we do post-training, fine-tuning, and auto-prompting». **[Ф]**
- **Вывод [В], уверенность средняя**: DoP почти наверняка — файнтюн видео-DiT класса **Wan2.1-I2V-14B-720P**: 81 кадр и параметр `guide_scale` в точности повторяют сигнатуру `Wan2.1 image2video.generate(frame_num=81, guide_scale=5.0)`; нативные 720p; OOM на 80 GB при 1080p характерен для 14B DiT; Wan2.1 вышла 25.02.2025, DoP — 31.03.2025. «RL after diffusion» — reward/preference пост-тренинг на качество камерного движения. Пресеты `motions[{id, strength}]` с лимитом 2 и категорией «Mix» выглядят как смешивание адаптеров по типу движения.
- «Cinematic camera control» на практике: непрозрачный `motion id` + `strength` + промпт (+ LLM-рерайт `enhance_prompt`, по умолчанию `true`) + опциональный последний кадр. Никаких числовых параметров камеры. Камера не параметрическая — категориальный prior. **[Ф]**
- 720p, ~5 с фиксировано, полей duration/aspect нет (PR genfeed.ai: DoP «Ignores aspect ratio and duration parameters»). 81 кадр → 16 fps **[В]**.

## 2. Где DoP доступен по API

| Площадка | Эндпоинт | Поля | Цена | Лимиты |
|---|---|---|---|---|
| **Официальный** (`api.higgsfield.ai`, OpenAPI v2.0.0) | `POST /higgsfield-ai/dop/standard`, `/turbo`, `/lite` | `prompt` (required); `image_url` (required); `end_image_url`; `motions` [{`id` uuid, `strength` 0–1, шаг 0.01}] `maxItems: 2`; `seed` 1–1 000 000; `enhance_prompt` (default **true**). Ответ: `status ∈ queued|in_progress|nsfw|failed|completed|canceled`, `request_id`, `status_url`, `cancel_url`, `video.url`. Заголовок `Authorization: Key KEY_ID:KEY_SECRET` | Блог: «DoP $0.125 / generation» (тир не указан); по зеркалам: lite ≈ $0.125, turbo ≈ $0.41, standard ≈ $0.56 | 20 параллельных запросов на ключ; предоплата от $5; failed/nsfw не тарифицируются; файлы ≥7 дней. ToS: «Company does not claim ownership of any of your Inputs or Outputs, nor does it restrict your commercial use of Outputs» |
| Legacy v1 (`platform.higgsfield.ai`, SDK `@higgsfield/client`) | `POST /v1/image2video/dop`; `GET /v1/motions` | `model: 'dop-lite'|'dop-turbo'|'dop-standard'`; `input_images`; `motions`; `seed`; `enhance_prompt` | как выше | |
| **Segmind** | `POST https://api.segmind.com/v1/higgsfield-image2video` | `model`, `prompt`, `seed`, `motion_id` (122 значения), `enhance_prompt`, `motion_strength` (default **0.8**), `check_nsfw`, `image_urls` | lite $0.16, turbo $0.51, preview $0.70 | ~201 с |
| **Pixazo** | `POST gateway.pixazo.ai/ai-model-api/v1/image-to-video` | `model`, `prompt`, `input_images[]`, `input_images_end[]`, `seed`, `enhance_prompt`, `motions_id`, `motions_strength` | lite $0.135, turbo $0.416, preview $0.573 | success 79,8 %, среднее 5,8 мин |
| **Eachlabs** | `higgsfield-ai-visual-effects` | `image_url`, `prompt`, `motions`, `model`, `seed`, `enhance_prompt` | $0.125 / $0.406 / $0.563 | «up to 720p» |
| WaveSpeed / fal.ai / Replicate / PiAPI | — | — | — | **DoP отсутствует** (WaveSpeed 404) |

## 3. Пресеты `motion_id` (API Segmind, 122)

Камерные, релевантные статичной сцене (ID из API; веб-ID на `higgsfield.ai/motion/…` другие):
- Static — `fa3ddb7c-53ee-4383-aa17-97ae65f180e5`
- Dolly In — `81ca2cd2-05db-4222-9ba0-a32e5185adfb`; Dolly Out — `12ac8798-5370-4801-91a6-f1acb425fc4a`
- Dolly Left — `71f0f8bc-0e5d-4d32-b34f-bd74a5e3cba8`; Dolly Right — `15ddc007-4723-42c1-8446-2af69af4879f`
- Super Dolly In — `3a24a20d-b494-4e8a-9b5f-4ef05ee5073d`; Super Dolly Out — `679c128d-a109-4267-8007-12f653f6346d`
- Zoom In — `fbcbec5b-30f8-4b17-ba6e-8e8d5b265562`; Zoom Out — `263600e4-45c0-4c13-9579-40a9278af37c`
- Tilt up — `2c9af101-fe7a-4299-91f3-e44431a0576f`; Tilt Down — `ff67b0eb-a621-45a0-b92d-ce2549250149`
- Crane Up — `68af9add-43ea-4261-a706-16b640fdcff9`; Crane Down — `b26dcbe5-e784-4893-b8a3-2bd4f848e90a`; Jib Up — `cc5d4b42-f05d-41ef-9f51-c4b28f3fd2d2`; Jib Down — `2ce412eb-2e66-4d73-9c9c-d1fba4c8a494`
- Arc Left — `c5881721-05b1-47d9-94d6-0203863114e1`; Arc Right — `a85cb3f2-f2be-4ee2-b3b9-808fc6a81acc`; 360 Orbit — `ea035f68-b350-40f1-b7f4-7dff999fdd67`
- Dolly Zoom In — `f0ca4e62-f65d-4a6d-83c1-ecbaa4d492ba`; Dolly Zoom Out — `2df82f5f-064a-4a7e-8b59-24ac446cb1df`
- Focus Change — `797e27b5-2e6e-4b9a-a3c1-d437e9d386fc`; Overhead — `40245735-2670-4572-b46e-854151281f55`
- **Pan Left/Right, Truck, Pedestal в API-списке отсутствуют** (Pan есть в вебе только на Wan 2.5).
- Остальные ~60 — VFX (Building Explosion, Melting, Datamosh, VHS…).

Strength: 0–1, максимум 2 пресета; дефолт Segmind 0.8; рекомендации 0.3–1.0; официальных рекомендаций для статичных сцен нет. **[Ф]**

## 4. Не-DoP функции: своё или обёртки

Cinema Studio — слой управления над сторонними моделями (Seedance 2.0, Veo 3.1, Kling 3.0); «Create 3D scene» — Gaussian splat → снимок → регенерация картинки, выход картинка; Camera Controls — 4 семейства (`higgsfield` 175 семплов, `wan2_5_video` 28, `minimax` 26, `kling` 4); Motion Control — Kling; Draw-to-Video — Veo 3 / Hailuo 02 / Seedance; Angles 2.0 — Nano Banana; 3D Jutsu — Meshy/Tripo/SAM 3 + Seedance 2.5. **[Ф]**

## 5. Качество на статичных сценах

Строгих независимых бенчмарков DoP vs Kling/Veo на интерьерах **нет**. Curious Refuge: движение 3,6/10; HitPaw: 720p, «defaulted to a static output»; Dynalord: Kling «edges it on physical realism», «3–5x re-roll rate»; Clipia: strength 1.0 искажает пропорции; Higgsfield сам: «background elements are low-priority… the model fills them in». **Вывод [В]**: DoP даёт более предсказуемый *тип* движения, но нет свидетельств, что он лучше Kling/Veo сохраняет геометрию. Подходят только Static, Dolly In/Out, Zoom, Tilt, Arc при strength 0.3–0.5.

## 6. Вердикт по 3D

**DoP не строит 3D-сцену.** В API нет позы камеры, глубины, траектории. Параметры инференса (`frames:81, steps:20, guide_scale:6`, 720p) — обычный 2D видео-DiT семейства Wan2.1. Всё 3D у Higgsfield живёт в других продуктах (Cinema Studio 3D-снимок, Angles, 3D Jutsu), ни одно не доступно по API для видео. **[Ф по отсутствию + В]**

## 7. Как использовать, если пробовать

```
POST https://api.higgsfield.ai/higgsfield-ai/dop/standard   (или /lite)
Authorization: Key <id>:<secret>
{
  "prompt": "static interior photo, camera slowly dollies in, furniture, walls and layout stay exactly as in the image, no new objects, no people, no lighting change",
  "image_url": "https://…/room.jpg",
  "motions": [{ "id": "81ca2cd2-05db-4222-9ba0-a32e5185adfb", "strength": 0.4 }],
  "enhance_prompt": false,
  "seed": 12345
}
```
затем `GET /requests/{request_id}/status` до `completed`. `enhance_prompt:false`, чтобы LLM-рерайт не дописывал объекты. Стоимость 5-с клипа: lite ≈ $0.125, turbo ≈ $0.41, standard ≈ $0.56; на том же API Kling 2.5 $0.105 за 5 с, Kling 3.0 $0.21 (акция), Wan 3.0 $0.24. Латентность 1–6 мин, success ~80 % у посредника. Ограничения: 720p, ~5 с, нет aspect/duration, ≤2 пресета, 20 параллельных запросов.

## Источники частей 4–5

Официальные Higgsfield: https://higgsfield.ai/ · https://higgsfield.ai/about · https://higgsfield.ai/pricing · https://higgsfield.ai/camera-controls · https://higgsfield.ai/ai/video · https://higgsfield.ai/cinematic-video-generator · https://higgsfield.ai/3d-jutsu · https://higgsfield.ai/plugins/blender · https://higgsfield.ai/apps/angles · https://higgsfield.ai/higgsfield-api · https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-dop · https://higgsfield.ai/creator-hub/help-center/ai-models/which-ai-model-should-i-use · https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api · https://higgsfield.ai/creator-hub/changelog · https://higgsfield.ai/blog/cinema-studio-guide · https://higgsfield.ai/blog/cinema-studio-4-0 · https://higgsfield.ai/blog/ai-video-camera-control · https://higgsfield.ai/blog/how-to-avoid-distortions-ai-videos · https://higgsfield.ai/blog/higgsfield-3d-jutsu · https://higgsfield.ai/blog/higgsfield-api · https://higgsfield.ai/terms-of-use-agreement · https://docs.higgsfield.ai/docs · https://docs.higgsfield.ai/docs/openapi.json · https://docs.higgsfield.ai/docs/concepts/rate-limits · https://console.higgsfield.ai/pricing · https://github.com/higgsfield-ai/higgsfield-js · https://x.com/higgsfield_ai/status/1906783445998576078

API-хосты: https://www.segmind.com/models/higgsfield-image2video/api · https://www.segmind.com/models/higgsfield-image2video/pricing · https://www.pixazo.ai/models/image-to-video/dop-api · https://www.eachlabs.ai/higgsfield/higgsfield/higgsfield-ai-visual-effects · https://github.com/genfeedai/genfeed.ai/pull/4839

Техника, интервью: https://sacra.com/research/alex-mashrabov-higgsfield-ai-video-production/ · https://www.aibase.com/news/16761 · https://www.tomsguide.com/ai/ai-image-video/meet-higgsfield-a-new-ai-video-generator-promising-advanced-camera-controls · https://nebius.com/customer-stories/higgsfield-ai · https://www.nvidia.com/en-us/case-studies/higgsfield/ · https://deepnewz.com/ai-modeling/higgsfield-dop-model-beats-nvidia-image-to-video-generation-20-faster-35-cheaper-e7448af2 · https://github.com/Wan-Video/Wan2.1 · https://www.fleshsyntax.com/higgsfield-cinema-studio-2-0-create-3d-scene-how-it-works-why-it-fails-and-how-to-salvage-a-bad-output/ · https://scriptable.com/posts/higgsfield/3d-models/ · https://chasejarvis.com/blog/higgsfield-angles-2-0-is-here-my-100-honest-review/ · https://openai.com/index/higgsfield/ · https://techcrunch.com/2026/08/17/higgsfield-raises-400m-series-b-quadrupling-its-valuation-in-8-months-to-5-4b/ · https://www.saastr.com/500m-arr-60-engineers-cash-flow-positive-how-higgsfield-actually-runs-with-ceo-alex-mashrabov/

Качество: https://www.redraw.pro/en/blog/redraw-vs-higgsfield-architecture-2026 · https://www.meltflexai.com/blog/higgsfield-real-estate-walkthrough-videos · https://curiousrefuge.com/blog/higgsfield-ai-video-generator-review · https://www.hitpaw.com/ai-model-tips/kling-vs-higgsfield.html · https://dynalord.com/blog/higgsfield-review · https://clipia.ai/en/video-models/higgsfield-dop · https://memons.ai/higgsfield-prompt-cheat-sheet · https://www.youtube.com/watch?v=ReASV_e1mwc · https://www.youtube.com/watch?v=I2np1Ds4Yh8
