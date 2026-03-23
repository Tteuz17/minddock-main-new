import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

const CACHE_CONTROL = "public, max-age=31536000, immutable"

const videoPath = path.resolve(
  process.cwd(),
  "..",
  "public",
  "lp",
  "gif and videos",
  "prompts ageis.mp4"
)

function parseRangeHeader(rangeHeader: string, fileSize: number) {
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
  if (!match) return null

  const [, startRaw, endRaw] = match
  let start = startRaw ? Number.parseInt(startRaw, 10) : 0
  let end = endRaw ? Number.parseInt(endRaw, 10) : fileSize - 1

  if (!startRaw && endRaw) {
    const suffixLength = Number.parseInt(endRaw, 10)
    if (Number.isNaN(suffixLength)) return null
    start = Math.max(fileSize - suffixLength, 0)
    end = fileSize - 1
  }

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end >= fileSize ||
    start > end
  ) {
    return null
  }

  return { start, end }
}

export async function GET(request: Request) {
  const fileStat = await stat(videoPath)
  const fileSize = fileStat.size
  const rangeHeader = request.headers.get("range")

  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, fileSize)

    if (!range) {
      return new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes */${fileSize}`,
        },
      })
    }

    const { start, end } = range
    const chunkSize = end - start + 1
    const stream = createReadStream(videoPath, { start, end })

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": chunkSize.toString(),
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": CACHE_CONTROL,
      },
    })
  }

  const stream = createReadStream(videoPath)

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": fileSize.toString(),
      "Accept-Ranges": "bytes",
      "Cache-Control": CACHE_CONTROL,
    },
  })
}
