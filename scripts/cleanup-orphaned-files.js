const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const path = require('path')
const p = new PrismaClient()

async function cleanup() {
  const tracks = await p.track.findMany({ where: { file_path: { not: null } }, select: { file_path: true } })
  const dbPaths = new Set(tracks.map(t => t.file_path))

  function walk(dir) {
    let files = []
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) files = files.concat(walk(full))
        else if (['.mp3','.flac','.m4a','.opus','.ogg'].includes(path.extname(entry.name))) files.push(full)
      }
    } catch(e) {}
    return files
  }

  const allFiles = walk('/music')
  const orphans = allFiles.filter(f => dbPaths.has(f) === false)
  console.log('Orphaned files:', orphans.length)

  for (const f of orphans) {
    console.log('Deleting:', f)
    fs.unlinkSync(f)
    // Clean up empty dirs
    try {
      const albumDir = path.dirname(f)
      const artistDir = path.dirname(albumDir)
      if (fs.readdirSync(albumDir).length === 0) { fs.rmdirSync(albumDir); console.log('Removed dir:', albumDir) }
      if (fs.readdirSync(artistDir).length === 0) { fs.rmdirSync(artistDir); console.log('Removed dir:', artistDir) }
    } catch(e) {}
  }
  console.log('Done')
}

cleanup().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
