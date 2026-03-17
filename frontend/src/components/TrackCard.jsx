import { useState, useEffect } from 'react';
import StatusBadge from './StatusBadge';

export default function TrackCard({
  track,
  selected,
  onSelect,
  onIgnore,
  onUnignore,
  onUnblock,
  onDownload,
  onRetry,
}) {
  const [progress, setProgress] = useState(null);
  const [localStatus, setLocalStatus] = useState(track.status);
  const [localError, setLocalError] = useState(track.download_error);

  useEffect(() => {
    // Keep local state in sync with track prop changes from SSE
    setLocalStatus(track.status);
    setLocalError(track.download_error);
  }, [track.status, track.download_error]);

  const handleIgnoreClick = () => {
    if (localStatus === 'ignored') {
      onUnignore(track.id);
    } else {
      onIgnore(track.id);
    }
  };

  const handleDownloadClick = () => {
    // Optimistic UI update: clear error and set status to pending/downloading
    setLocalError(null);
    setLocalStatus('pending');
    if (onDownload) {
      onDownload(track.id);
    }
  };

  const handleRetryClick = () => {
    // Optimistic UI update: clear error and set status to pending
    setLocalError(null);
    setLocalStatus('pending');
    if (onRetry) {
      onRetry(track.id);
    }
  };

  const getSourceBadge = () => {
    switch (track.source) {
      case 'loved':
        return <span className="text-xs bg-red-900 text-red-300 px-2 py-1 rounded">❤️ Loved</span>;
      case 'album':
        return (
          <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded">
            💿 {track.album_name || 'Album'}
          </span>
        );
      case 'playlist':
        return (
          <span className="text-xs bg-purple-900 text-purple-300 px-2 py-1 rounded">
            📋 {track.playlist_name || 'Playlist'}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`bg-gray-800 rounded-lg p-4 border transition cursor-pointer ${selected ? 'border-indigo-500 bg-gray-750' : 'border-gray-700 hover:border-gray-600'}`} onClick={() => onSelect && onSelect(track.id)}>
      <div className="flex gap-4">
        {/* Checkbox */}
        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onSelect && onSelect(track.id)}
            className="w-4 h-4 accent-indigo-500 cursor-pointer"
          />
        </div>
        {track.album_art_url ? (
          <img
            src={track.album_art_url}
            alt={`${track.artist} - ${track.title}`}
            className="w-16 h-16 rounded object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded bg-gray-700 flex-shrink-0 flex items-center justify-center">
            <span className="text-gray-500 text-sm">♫</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white truncate">{track.title}</h3>
          <p className="text-sm text-gray-400 truncate">{track.artist}</p>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusBadge status={localStatus} />
            {getSourceBadge()}
            {track.account_label && (
              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">
                👤 {track.account_label}
              </span>
            )}
          </div>

          {/* Progress Bar */}
          {progress && (
            <div className="mt-3 space-y-1">
              <div className="w-full bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="text-xs text-gray-400 flex justify-between">
                <span>{progress.percent.toFixed(1)}%</span>
                <span>{progress.speed}</span>
                <span>ETA: {progress.eta}</span>
              </div>
            </div>
          )}

          {/* File Path or Error Message */}
          {track.file_path ? (
            <div className="mt-2 text-xs text-green-400 truncate" title={track.file_path}>
              ✅ {track.file_path}
            </div>
          ) : localError ? (
            <div className="mt-2 text-xs text-red-400 truncate" title={localError}>
              ❌ {localError}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-end justify-between gap-2">
          <div className="flex gap-2">
            {(localStatus === 'pending' || localStatus === 'failed') && onDownload && (
              <button
                onClick={handleDownloadClick}
                className="text-xs px-3 py-1 rounded bg-blue-700 hover:bg-blue-600 text-blue-300 transition"
                title="Download now"
              >
                ⬇️
              </button>
            )}

            {localStatus === 'failed' && onRetry && (
              <button
                onClick={handleRetryClick}
                className="text-xs px-3 py-1 rounded bg-orange-700 hover:bg-orange-600 text-orange-300 transition"
                title="Retry download"
              >
                🔄
              </button>
            )}

            {localStatus === 'blocked' ? (
              <button
                onClick={() => onUnblock && onUnblock(track.id)}
                className="text-xs px-3 py-1 rounded bg-yellow-800 hover:bg-yellow-700 text-yellow-300 transition"
              >
                🔓 Unblock
              </button>
            ) : (
              <button
                onClick={handleIgnoreClick}
                className={`text-xs px-3 py-1 rounded transition ${
                  localStatus === 'ignored'
                    ? 'bg-green-900 hover:bg-green-800 text-green-400'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                {localStatus === 'ignored' ? 'Restore' : 'Ignore'}
              </button>
            )}
          </div>

          {track.downloaded_at && (
            <div className="text-xs text-gray-500">
              {new Date(track.downloaded_at).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
