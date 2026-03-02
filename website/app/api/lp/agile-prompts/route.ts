import { readFile } from "node:fs/promises"
import path from "node:path"

export async function GET() {
  const videoPath = path.resolve(
    process.cwd(),
    "..",
    "public",
    "lp",
    "gif and videos",
    "prompts ageis.mp4"
  )

  const file = await readFile(videoPath)

  return new Response(file, {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "public, max-age=3600"
    }
  })
}
