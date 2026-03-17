const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkPlayingGod() {
  try {
    const track = await prisma.track.findMany({
      where: {
        title: { contains: 'Playing God' }
      },
      select: {
        id: true,
        artist: true,
        title: true,
        status: true,
        download_error: true,
        retry_count: true,
        youtube_url: true,
        youtube_video_id: true,
        file_path: true,
        created_at: true,
        updated_at: true,
      }
    });

    console.log('Track Details:');
    console.log(JSON.stringify(track, null, 2));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPlayingGod();
