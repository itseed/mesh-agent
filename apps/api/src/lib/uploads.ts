import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface InlineImage {
  name: string
  mimeType: string
  data: string // base64 (no data: prefix)
}

const UPLOAD_BASE = process.env.CHAT_UPLOAD_DIR ?? '/tmp/meshagent-uploads'

function safeFilename(name: string): string {
  return name.replace(/[^\w.-]/g, '_').slice(0, 100) || 'file'
}

// Persists user-attached images to disk so the Claude CLI Read tool can pull
// them into Lead/agent context. Returns absolute paths.
export function saveImagesForBucket(bucketId: string, images: InlineImage[]): string[] {
  if (!images || images.length === 0) return []
  const dir = join(UPLOAD_BASE, bucketId)
  mkdirSync(dir, { recursive: true })
  const paths: string[] = []
  images.forEach((img, idx) => {
    const filename = `${String(idx).padStart(2, '0')}-${safeFilename(img.name)}`
    const fullPath = join(dir, filename)
    writeFileSync(fullPath, Buffer.from(img.data, 'base64'))
    paths.push(fullPath)
  })
  return paths
}
