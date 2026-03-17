import { useState, useEffect } from 'react';
import TrackCard from '../components/TrackCard';
import SyncStats from '../components/SyncStats';
import ActivityLog from '../components/ActivityLog';

export default function Dashboard() {
  const [tracks, setTracks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [retryingFailed, setRetryingFailed] = useState(false);

  // Feature 1: Account filter
  const [selectedAccounts, setSelectedAccounts] = useState([]);

  // Feature 2: Track selection + delete
  const [selectedTracks, setSelectedTracks] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  // Feature 3: Manual add
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualForm, setManualForm] = useState({ youtube_url: '', title: '', artist: '', album_name: '' });
  const [manualAdding, setManualAdding] = useState(false);
  const [manualError, setManualError] = useState('');

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, sourceFilter, searchQuery, pageSize, selectedAccounts]);

  useEffect(() => {
    fetchTracksAndStats({ page: currentPage, pageSize, statusFilter, sourceFilter, searchQuery, selectedAccounts });
    const interval = setInterval(() => fetchTracksAndStats({ page: currentPage, pageSize, statusFilter, sourceFilter, searchQuery, selectedAccounts }), 30000);
    return () => clearInterval(interval);
  }, [statusFilter, sourceFilter, searchQuery, pageSize, currentPage, selectedAccounts]);

  useEffect(() => {
    const eventSource = new EventSource('/api/events');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (['track_updated','track_downloaded','track_downloading','track_failed'].includes(data.type)) {
          setTracks((prev) => prev.map((t) => {
            if (t.id !== data.trackId) return t;
            return {
              ...t,
              status: data.status ?? t.status,
              download_error: 'download_error' in data ? data.download_error : t.download_error,
              file_path: data.filePath ?? t.file_path,
            };
          }));
        }
      } catch (err) { console.error('SSE parse error:', err); }
    };
    eventSource.onerror = () => { eventSource.close(); };
    return () => eventSource.close();
  }, []);

  const fetchTracksAndStats = async (overrides = {}) => {
    const _page = overrides.page ?? currentPage;
    const _pageSize = overrides.pageSize ?? pageSize;
    const _statusFilter = overrides.statusFilter ?? statusFilter;
    const _sourceFilter = overrides.sourceFilter ?? sourceFilter;
    const _searchQuery = overrides.searchQuery ?? searchQuery;
    const _selectedAccounts = overrides.selectedAccounts ?? selectedAccounts;

    try {
      let url = `/api/tracks?sort=created_at&order=desc&limit=${_pageSize}&page=${_page}`;
      if (_statusFilter !== 'blocked') url += `&excludeStatus=blocked`;
      if (_statusFilter !== 'all') url += `&status=${_statusFilter}`;
      if (_sourceFilter !== 'all') url += `&source=${_sourceFilter}`;
      if (_selectedAccounts.length > 0) url += `&accounts=${_selectedAccounts.join(',')}`;

      const [tracksRes, statsRes] = await Promise.all([fetch(url), fetch('/api/stats')]);
      const tracksData = await tracksRes.json();
      const statsData = await statsRes.json();

      let filteredTracks = tracksData.data;
      if (_searchQuery.trim()) {
        const query = _searchQuery.toLowerCase();
        filteredTracks = filteredTracks.filter((t) =>
          t.title.toLowerCase().includes(query) ||
          t.artist.toLowerCase().includes(query) ||
          (t.album && t.album.toLowerCase().includes(query))
        );
      }

      setTracks(filteredTracks);
      setStats(statsData);
      setTotalPages(tracksData.pages || 1);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAccount = (label) => {
    if (label === null) { setSelectedAccounts([]); return; }
    setSelectedAccounts((prev) =>
      prev.includes(label) ? prev.filter((a) => a !== label) : [...prev, label]
    );
  };

  const handleToggleTrack = (trackId) => {
    setSelectedTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId); else next.add(trackId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedTracks.size === tracks.length) {
      setSelectedTracks(new Set());
    } else {
      setSelectedTracks(new Set(tracks.map((t) => t.id)));
    }
  };

  const handleDeleteSelected = async (mode) => {
    if (selectedTracks.size === 0) return;
    setDeleting(true);
    try {
      await fetch('/api/tracks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: [...selectedTracks],
          deleteFiles: mode === 'block_delete' || mode === 'purge',
          purge: mode === 'purge',
        }),
      });
      setSelectedTracks(new Set());
      await fetchTracksAndStats();
    } catch (error) {
      console.error('Error deleting tracks:', error);
    } finally {
      setDeleting(false);
    }
  };

  const handleManualAdd = async () => {
    setManualError('');
    if (!manualForm.youtube_url || !manualForm.title || !manualForm.artist) {
      setManualError('YouTube URL, title, and artist are required.');
      return;
    }
    setManualAdding(true);
    try {
      const res = await fetch('/api/tracks/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualForm),
      });
      const data = await res.json();
      if (!res.ok) { setManualError(data.error || 'Failed to add track'); return; }
      setManualForm({ youtube_url: '', title: '', artist: '', album_name: '' });
      setShowManualAdd(false);
      await fetchTracksAndStats();
    } catch (error) {
      setManualError('Failed to add track');
    } finally {
      setManualAdding(false);
    }
  };

  const handleIgnore = async (trackId) => {
    try { await fetch(`/api/tracks/${trackId}/ignore`, { method: 'PATCH' }); await fetchTracksAndStats(); } catch {}
  };
  const handleUnblock = async (trackId) => {
    try { await fetch(`/api/tracks/${trackId}/unblock`, { method: 'PATCH' }); await fetchTracksAndStats(); } catch {}
  };
  const handleUnignore = async (trackId) => {
    try { await fetch(`/api/tracks/${trackId}/unignore`, { method: 'PATCH' }); await fetchTracksAndStats(); } catch {}
  };
  const handleDownloadTrack = async (trackId) => {
    try { const r = await fetch(`/api/sync/tracks/${trackId}/download`, { method: 'POST' }); if (r.ok) await fetchTracksAndStats(); } catch {}
  };
  const handleRetryTrack = async (trackId) => {
    try { await fetch(`/api/sync/tracks/${trackId}/download`, { method: 'POST' }); } catch {}
  };
  const handleRetryAllFailed = async () => {
    setRetryingFailed(true);
    setTracks((prev) => prev.map((t) => t.status === 'failed' ? { ...t, status: 'pending', download_error: null } : t));
    try { await fetch('/api/sync/retry-failed', { method: 'POST' }); } catch {} finally { setRetryingFailed(false); }
  };
  const handleManualSync = async () => {
    setSyncing(true);
    try { await fetch('/api/sync', { method: 'POST' }); setTimeout(() => { fetchTracksAndStats(); setSyncing(false); }, 2000); } catch { setSyncing(false); }
  };
  const handleManualFileScan = async () => {
    setScanning(true);
    try { await fetch('/api/sync/file-scan', { method: 'POST' }); setTimeout(() => { fetchTracksAndStats(); setScanning(false); }, 2000); } catch { setScanning(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="text-white">Loading...</div>
    </div>
  );

  const failedCount = stats?.status?.failed || 0;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-4xl font-bold">🎵 LikedFM</h1>
            <p className="text-gray-400 mt-1">Music taste sync for Last.fm + YouTube</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {failedCount > 0 && (
              <button onClick={handleRetryAllFailed} disabled={retryingFailed}
                className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-semibold transition text-sm">
                {retryingFailed ? '🔄 Retrying...' : `🔄 Retry ${failedCount} Failed`}
              </button>
            )}
            <button onClick={() => setShowManualAdd((v) => !v)}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold transition text-sm">
              ➕ Add Track
            </button>
            <button onClick={handleManualSync} disabled={syncing}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-semibold transition text-sm">
              {syncing ? '🔄 Syncing...' : '🔄 Sync Now'}
            </button>
            <button onClick={handleManualFileScan} disabled={scanning}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-semibold transition text-sm">
              {scanning ? '📁 Scanning...' : '📁 Scan Files'}
            </button>
          </div>
        </div>

        {/* Manual Add Panel */}
        {showManualAdd && (
          <div className="mb-6 bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-white">➕ Add Track Manually</h3>
            {manualError && <p className="text-red-400 text-sm">{manualError}</p>}
            <input
              type="text" placeholder="YouTube URL *"
              value={manualForm.youtube_url}
              onChange={(e) => setManualForm((f) => ({ ...f, youtube_url: e.target.value }))}
              className="w-full px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="text" placeholder="Song / Podcast title *"
                value={manualForm.title}
                onChange={(e) => setManualForm((f) => ({ ...f, title: e.target.value }))}
                className="px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
              />
              <input
                type="text" placeholder="Artist / Author *"
                value={manualForm.artist}
                onChange={(e) => setManualForm((f) => ({ ...f, artist: e.target.value }))}
                className="px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
              />
              <input
                type="text" placeholder="Album / Show (optional)"
                value={manualForm.album_name}
                onChange={(e) => setManualForm((f) => ({ ...f, album_name: e.target.value }))}
                className="px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleManualAdd} disabled={manualAdding}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-semibold transition text-sm">
                {manualAdding ? 'Adding...' : 'Add & Download'}
              </button>
              <button onClick={() => { setShowManualAdd(false); setManualError(''); }}
                className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-4 py-2 rounded-lg transition text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Stats */}
        {stats && <SyncStats stats={stats} selectedAccounts={selectedAccounts} onToggleAccount={handleToggleAccount} />}

        {/* Status Filters */}
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Status</h3>
          <div className="flex gap-2 overflow-x-auto">
            {['all', 'pending', 'downloading', 'downloaded', 'failed', 'ignored', 'blocked'].map((status) => (
              <button key={status} onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-lg font-semibold transition whitespace-nowrap text-sm ${
                  statusFilter === status ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Source Filters */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Source</h3>
          <div className="flex gap-2 overflow-x-auto">
            {['all', 'loved', 'album', 'playlist'].map((source) => (
              <button key={source} onClick={() => setSourceFilter(source)}
                className={`px-4 py-2 rounded-lg font-semibold transition whitespace-nowrap text-sm ${
                  sourceFilter === source ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}>
                {source === 'all' && 'All Sources'}
                {source === 'loved' && '❤️ Loved'}
                {source === 'album' && '💿 Albums'}
                {source === 'playlist' && '📋 Playlists'}
              </button>
            ))}
          </div>
        </div>

        {/* Search + Per Page */}
        <div className="mb-4 flex gap-4 items-end flex-wrap">
          <div className="flex-1 min-w-64">
            <label className="text-sm font-semibold text-gray-300 mb-2 block">🔍 Search</label>
            <input type="text" placeholder="Search tracks..."
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-gray-800 text-white border border-gray-700 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-semibold text-gray-300 mb-2 block">Per page</label>
            <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value))}
              className="px-4 py-2 rounded-lg bg-gray-800 text-white border border-gray-700 focus:border-blue-500 focus:outline-none text-sm">
              {[10,25,50,100,250].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        {/* Selection toolbar */}
        <div className="mb-4 flex items-center gap-2">
          <button onClick={handleSelectAll}
            className="text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded transition">
            {selectedTracks.size === tracks.length && tracks.length > 0 ? '☑ Deselect All' : '☐ Select All'}
          </button>
        </div>

        {selectedTracks.size > 0 && (
          <div className="mb-4 flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
            <span className="text-sm text-gray-300">{selectedTracks.size} selected</span>
            <button onClick={() => handleDeleteSelected('block')} disabled={deleting}
              className="text-sm bg-yellow-700 hover:bg-yellow-600 disabled:bg-gray-600 text-white px-3 py-1 rounded transition">
              🚫 Block
            </button>
            <button onClick={() => handleDeleteSelected('block_delete')} disabled={deleting}
              className="text-sm bg-orange-700 hover:bg-orange-600 disabled:bg-gray-600 text-white px-3 py-1 rounded transition">
              🚫 Block + Delete File
            </button>
            <button onClick={() => handleDeleteSelected('purge')} disabled={deleting}
              className="text-sm bg-red-700 hover:bg-red-600 disabled:bg-gray-600 text-white px-3 py-1 rounded transition">
              🗑 Remove Completely
            </button>
            <button onClick={() => setSelectedTracks(new Set())}
              className="text-sm text-gray-500 hover:text-gray-300 transition ml-auto">
              Clear selection
            </button>
          </div>
        )}

        {/* Pagination Info */}
        {tracks.length > 0 && (
          <div className="mb-4 flex items-center justify-between text-sm text-gray-400">
            <span>Page <span className="font-semibold text-white">{currentPage}</span> of <span className="font-semibold text-white">{totalPages}</span></span>
            <div className="flex gap-2">
              <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
                className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 transition">← Prev</button>
              <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}
                className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 transition">Next →</button>
            </div>
          </div>
        )}

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
                selected={selectedTracks.has(track.id)}
                onSelect={handleToggleTrack}
                onIgnore={handleIgnore}
                onUnignore={handleUnignore}
                onUnblock={handleUnblock}
                onDownload={handleDownloadTrack}
                onRetry={handleRetryTrack}
              />
            ))
          )}
        </div>

        <ActivityLog />
      </div>
    </div>
  );
}
