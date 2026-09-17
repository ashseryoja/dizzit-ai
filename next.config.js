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
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/api/album": ["./public/fonts/**/*"],
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
