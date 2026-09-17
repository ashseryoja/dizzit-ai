/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Каталог сборки можно увести переменной окружения: параллельные dev-серверы
  // (несколько сессий Claude, dev+build) на общем .next портят кэш webpack
  // друг другу — «__webpack_modules__[moduleId] is not a function» и 500.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Альбом-презентация (src/server/album-*): @react-pdf/renderer — ESM-пакет
  // с pdfkit и fontkit внутри, в бандл сервера его не тянем, а шрифты из
  // public/fonts должны попасть в функцию /api/album на Vercel.
  //
  // Стандартные шрифты pdfkit — туда же вручную: при создании любого документа
  // pdfkit грузит Helvetica через createRequire('#standard-fonts/Helvetica')
  // (алиас из поля imports его package.json), а трассировщик файлов Next такой
  // require не видит. Без этой строки на Vercel сборка PDF падает с
  // «Cannot find module …/pdfkit/js/standard-fonts/Helvetica.cjs», хотя локально
  // всё работает (node_modules целиком на месте).
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/api/album": ["./public/fonts/**/*", "./node_modules/pdfkit/js/standard-fonts/**/*"],
    "/api/album/copy": ["./public/fonts/**/*"],
  },
  experimental: {
    // Пока есть middleware, Next отдаёт роутам только первые 10 МБ тела.
    // В локальном режиме без сервера альбом присылает картинки прямо в
    // запросе (JPEG-копии до 1800 px, десятки штук) — лимит шире.
    middlewareClientMaxBodySize: "64mb",
  },
  async headers() {
    return [
      {
        // Шрифты неизменны по содержимому: при замене файла меняем ИМЯ (-v3),
        // иначе браузер отдаст старую версию из immutable-кэша.
        source: "/fonts/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ]
  },
}

export default nextConfig
