import { useState, useEffect } from 'react';
import TrackCard from '../components/TrackCard';
import SyncStats from '../components/SyncStats';
import ActivityLog from '../components/ActivityLog';

export default function Dashboard() {
  const [tracks, setTracks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchTracksAndStats();
    const interval = setInterval(fetchTracksAndStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [filter]);

  const fetchTracksAndStats = async () => {
    try {
      const [tracksRes, statsRes] = await Promise.all([
        fetch(
          `/api/tracks?sort=created_at&order=desc&limit=100${
            filter !== 'all' ? `&status=${filter}` : ''
          }`
        ),
        fetch('/api/stats'),
      ]);

      const tracksData = await tracksRes.json();
      const statsData = await statsRes.json();

      setTracks(tracksData.data);
      setStats(statsData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleIgnore = async (trackId) => {
    try {
      await fetch(`/api/tracks/${trackId}/ignore`, { method: 'PATCH' });
      await fetchTracksAndStats();
    } catch (error) {
      console.error('Error ignoring track:', error);
    }
  };

  const handleUnignore = async (trackId) => {
    try {
      await fetch(`/api/tracks/${trackId}/unignore`, { method: 'PATCH' });
      await fetchTracksAndStats();
    } catch (error) {
      console.error('Error un-ignoring track:', error);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      setTimeout(() => {
        fetchTracksAndStats();
        setSyncing(false);
      }, 2000);
    } catch (error) {
      console.error('Error triggering sync:', error);
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold">🎵 LikedFM</h1>
            <p className="text-gray-400 mt-1">Music taste sync for Last.fm + Lidarr</p>
          </div>

          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold transition flex items-center gap-2"
          >
            {syncing ? '🔄 Syncing...' : '🔄 Sync Now'}
          </button>
        </div>

        {/* Stats */}
        {stats && <SyncStats stats={stats} />}

        {/* Filters */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {['all', 'pending', 'requested', 'downloaded', 'ignored'].map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-semibold transition whitespace-nowrap ${
                filter === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>

        {/* Track List */}
        <div className="grid grid-cols-1 gap-4 mb-8">
          {tracks.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg">No tracks to display</p>
              <p className="text-sm mt-2">Try clicking "Sync Now" to get started</p>
            </div>
          ) : (
            tracks.map((track) => (
              <TrackCard
                key={track.id}
                track={track}
                onIgnore={handleIgnore}
                onUnignore={handleUnignore}
              />
            ))
          )}
        </div>

        {/* Activity Log */}
        <ActivityLog />
      </div>
    </div>
  );
}
