const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function fixPlayingGod() {
  try {
    console.log('Fixing Playing God track...');

    // Update the track with the correct file path
    const updated = await prisma.track.update({
      where: { id: 1 },
      data: {
        file_path: '/music/NA/Playing God.mp3',
        status: 'downloaded',
        download_error: null,
        retry_count: 0,
      }
    });

    console.log('✅ Track updated:');
    console.log(JSON.stringify(updated, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixPlayingGod();
