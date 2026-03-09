import StatusBadge from './StatusBadge';

export default function TrackCard({
  track,
  onIgnore,
  onUnignore,
}) {
  const handleIgnoreClick = () => {
    if (track.status === 'ignored') {
      onUnignore(track.id);
    } else {
      onIgnore(track.id);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition">
      <div className="flex gap-4">
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
            <StatusBadge status={track.status} />

            {track.play_count > 0 && (
              <span className="text-xs text-gray-500">
                ♫ {track.play_count} plays
              </span>
            )}

            {track.loved && (
              <span className="text-xs text-red-400">❤️ Loved</span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end justify-center gap-2">
          <button
            onClick={handleIgnoreClick}
            className={`text-xs px-3 py-1 rounded transition ${
              track.status === 'ignored'
                ? 'bg-green-900 hover:bg-green-800 text-green-400'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            {track.status === 'ignored' ? 'Un-ignore' : 'Ignore'}
          </button>

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
