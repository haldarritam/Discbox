import { useEffect, useState } from 'react';

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    fetchLogs();

    // Connect to SSE for live updates
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'connected') {
        console.log('Connected to live events');
      } else if (
        data.type === 'track_requested' ||
        data.type === 'track_downloaded' ||
        data.type === 'sync_started' ||
        data.type === 'sync_completed'
      ) {
        const log = {
          type: data.type,
          message: formatMessage(data),
          timestamp: new Date(data.timestamp),
        };
        setLogs((prev) => [log, ...prev.slice(0, 19)]);
      }
    };

    eventSource.onerror = () => {
      console.error('SSE connection error');
      eventSource.close();
    };

    return () => eventSource.close();
  }, []);

  const fetchLogs = async () => {
    try {
      const response = await fetch('/api/sync/status');
      const data = await response.json();

      if (data.lastSync) {
        setLogs([
          {
            type: 'sync_completed',
            message: `Last sync: ${data.lastSync.tracks_found} found, ${data.lastSync.tracks_added} added (${data.lastSync.source})`,
            timestamp: new Date(data.lastSync.synced_at),
          },
        ]);
      }
    } catch (error) {
      console.error('Error fetching sync status:', error);
    }
  };

  const formatMessage = (event) => {
    switch (event.type) {
      case 'track_requested':
        return `Requested: ${event.track.artist} - ${event.track.title}`;
      case 'track_downloaded':
        return `Downloaded: ${event.track.artist} - ${event.track.title}`;
      case 'sync_started':
        return 'Sync started...';
      case 'sync_completed':
        return `Sync completed: ${event.summary?.tracksFound} found, ${event.summary?.tracksAdded} added`;
      default:
        return 'Event';
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="font-semibold text-white mb-4">Activity Log</h3>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {logs.length === 0 ? (
          <p className="text-gray-500 text-sm">No recent activity</p>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} className="text-sm text-gray-400 flex justify-between">
              <span>{log.message}</span>
              <span className="text-gray-600 text-xs">
                {log.timestamp.toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
