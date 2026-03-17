const { PrismaClient } = require('@prisma/client')
const fs = require('fs')
const p = new PrismaClient()
p.track.findMany({ 
  where: { file_path: { not: null }, status: 'downloaded' }, 
  select: { artist: true, title: true, file_path: true } 
}).then(tracks => {
  const missing = tracks.filter(t => fs.existsSync(t.file_path) === false)
  console.log('Missing:', missing.length)
  missing.forEach(t => console.log(' -', t.artist, '-', t.title))
  process.exit(0)
})
