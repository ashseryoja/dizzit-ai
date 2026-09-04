/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Каталог сборки можно увести переменной окружения: параллельные dev-серверы
  // (несколько сессий Claude, dev+build) на общем .next портят кэш webpack
  // друг другу — «__webpack_modules__[moduleId] is not a function» и 500.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
