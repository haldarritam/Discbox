import { useState } from 'react';

export default function SettingsForm({ onSave, initialSettings }) {
  const [formData, setFormData] = useState(initialSettings || {});
  const [loading, setLoading] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [message, setMessage] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleSave = async () => {
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error('Failed to save settings');

      setMessage('Settings saved successfully!');
      setTimeout(() => setMessage(''), 3000);

      if (onSave) onSave();
    } catch (error) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    setTestResults(null);

    try {
      const response = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const results = await response.json();
      setTestResults(results);
    } catch (error) {
      setTestResults({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <h2 className="text-xl font-bold text-white mb-6">Settings</h2>

      {message && (
        <div
          className={`mb-4 p-3 rounded text-sm ${
            message.includes('Error')
              ? 'bg-red-900 text-red-200'
              : 'bg-green-900 text-green-200'
          }`}
        >
          {message}
        </div>
      )}

      <div className="space-y-6">
        {/* Last.fm Settings */}
        <div className="space-y-3">
          <h3 className="font-semibold text-white text-lg">Last.fm</h3>

          <input
            type="text"
            name="lastfm_username"
            placeholder="Username"
            value={formData.lastfm_username || ''}
            onChange={handleChange}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />

          <input
            type="password"
            name="lastfm_api_key"
            placeholder="API Key"
            value={formData.lastfm_api_key || ''}
            onChange={handleChange}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />

          <input
            type="password"
            name="lastfm_secret"
            placeholder="Secret"
            value={formData.lastfm_secret || ''}
            onChange={handleChange}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Lidarr Settings */}
        <div className="space-y-3">
          <h3 className="font-semibold text-white text-lg">Lidarr</h3>

          <input
            type="text"
            name="lidarr_url"
            placeholder="Base URL (e.g. http://lidarr:8686)"
            value={formData.lidarr_url || ''}
            onChange={handleChange}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />

          <input
            type="password"
            name="lidarr_api_key"
            placeholder="API Key"
            value={formData.lidarr_api_key || ''}
            onChange={handleChange}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />

          <input
            type="text"
            name="music_root"
            placeholder="Music Root Path (e.g. /music)"
            value={formData.music_root || ''}
            onChange={handleChange}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Sync Settings */}
        <div className="space-y-3">
          <h3 className="font-semibold text-white text-lg">Sync Settings</h3>

          <div>
            <label className="flex items-center text-gray-300">
              <input
                type="checkbox"
                name="sync_loved"
                checked={formData.sync_loved || false}
                onChange={handleChange}
                className="mr-3"
              />
              Sync Loved Tracks
            </label>
          </div>

          <div>
            <label className="flex items-center text-gray-300">
              <input
                type="checkbox"
                name="sync_top"
                checked={formData.sync_top || false}
                onChange={handleChange}
                className="mr-3"
              />
              Sync Top Tracks
            </label>
          </div>

          <select
            name="top_period"
            value={formData.top_period || '1month'}
            onChange={handleChange}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="7day">Last 7 Days</option>
            <option value="1month">Last Month</option>
            <option value="3month">Last 3 Months</option>
            <option value="6month">Last 6 Months</option>
            <option value="12month">Last Year</option>
            <option value="overall">All Time</option>
          </select>

          <div>
            <label className="block text-gray-300 text-sm mb-1">
              Sync Interval (minutes)
            </label>
            <input
              type="number"
              name="sync_interval"
              value={formData.sync_interval || 360}
              onChange={handleChange}
              min="1"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-300 text-sm mb-1">
              Minimum Play Count
            </label>
            <input
              type="number"
              name="min_play_count"
              value={formData.min_play_count || 1}
              onChange={handleChange}
              min="0"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Test Results */}
        {testResults && (
          <div className="bg-gray-700 rounded p-4">
            <h4 className="font-semibold text-white mb-2">Connection Test Results</h4>
            {testResults.error ? (
              <p className="text-red-400 text-sm">{testResults.error}</p>
            ) : (
              <div className="space-y-2 text-sm">
                {testResults.lastfm && (
                  <p className={testResults.lastfm.success ? 'text-green-400' : 'text-red-400'}>
                    Last.fm: {testResults.lastfm.success ? '✓ Connected' : '✗ Failed'}
                  </p>
                )}
                {testResults.lidarr && (
                  <p className={testResults.lidarr.success ? 'text-green-400' : 'text-red-400'}>
                    Lidarr: {testResults.lidarr.success ? '✓ Connected' : '✗ Failed'}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4">
          <button
            onClick={handleSave}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-6 py-2 rounded font-semibold transition"
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>

          <button
            onClick={handleTest}
            disabled={loading}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-6 py-2 rounded font-semibold transition"
          >
            {loading ? 'Testing...' : 'Test Connections'}
          </button>
        </div>
      </div>
    </div>
  );
}
