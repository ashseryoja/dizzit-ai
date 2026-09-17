import "server-only"

import { deflateRawSync } from "node:zlib"

/**
 * Минимальный ZIP-архиватор без зависимостей: нужен, чтобы отдать OBJ одним
 * файлом вместе с материалом и текстурой (`src/server/meshy.ts`). Текст
 * сжимается deflate, уже сжатое (PNG/JPEG) кладётся как есть.
 */

export interface ZipEntry {
  name: string
  bytes: Uint8Array
  /** false — не сжимать (картинки). */
  compress?: boolean
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const raw = Buffer.from(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength)
    const compress = entry.compress !== false
    const data = compress ? deflateRawSync(raw, { level: 6 }) : raw
    const crc = crc32(entry.bytes)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // версия для распаковки
    local.writeUInt16LE(0x0800, 6) // имена в UTF-8
    local.writeUInt16LE(compress ? 8 : 0, 8)
    local.writeUInt16LE(0, 10) // время
    local.writeUInt16LE(0x21, 12) // дата: 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, name, data)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(compress ? 8 : 0, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt16LE(0x21, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + data.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...chunks, directory, end]))
}
