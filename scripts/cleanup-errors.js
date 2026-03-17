const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function cleanupPermissionErrors() {
  try {
    console.log('Searching for permission denied errors...');

    const tracksWithErrors = await prisma.track.findMany({
      where: {
        download_error: {
          contains: 'Permission denied'
        }
      }
    });

    console.log(`Found ${tracksWithErrors.length} tracks with permission errors`);

    if (tracksWithErrors.length > 0) {
      console.log('\nTracks to be cleared:');
      tracksWithErrors.forEach(track => {
        console.log(`  - ${track.artist} - ${track.title}`);
        console.log(`    Error: ${track.download_error}`);
      });

      // Clear all permission errors
      const result = await prisma.track.updateMany({
        where: {
          download_error: {
            contains: 'Permission denied'
          }
        },
        data: {
          download_error: null,
          status: 'pending'  // Reset to pending so they can be retried
        }
      });

      console.log(`\n✅ Cleared errors for ${result.count} tracks`);
      console.log('Tracks have been reset to "pending" status for retry');
    } else {
      console.log('No permission errors found');
    }

  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupPermissionErrors();
