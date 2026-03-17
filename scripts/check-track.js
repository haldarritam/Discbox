const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkTrack() {
  try {
    const track = await prisma.track.findMany({
      where: {
        OR: [
          { title: { contains: 'Playing God' } },
          { artist: { contains: 'Polyphia' } }
        ]
      }
    });

    console.log('Found tracks:');
    console.log(JSON.stringify(track, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTrack();
