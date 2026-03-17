import { useState, useEffect } from 'react';

export default function SettingsForm({ onSave, initialSettings }) {
  const [formData, setFormData] = useState(initialSettings || {});
  const [loading, setLoading] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [message, setMessage] = useState('');
  const [deezerAccounts, setDeezerAccounts] = useState([]);
  const [deezerForm, setDeezerForm] = useState({ user_id: '', label: '', sync_loved: true, sync_albums: true, sync_playlists: true });
  const [deezerTestResult, setDeezerTestResult] = useState(null);
  const [deezerLoading, setDeezerLoading] = useState(false);
  const [deezerMessage, setDeezerMessage] = useState('');

  useEffect(() => {
    fetchDeezerAccounts();
  }, []);

  const fetchDeezerAccounts = async () => {
    try {
      const res = await fetch('/api/deezer/accounts');
      const data = await res.json();
      setDeezerAccounts(data);
    } catch (err) {
      console.error('Failed to fetch Deezer accounts:', err);
    }
  };

  const handleDeezerTest = async () => {
    if (!deezerForm.user_id) return;
    setDeezerLoading(true);
    setDeezerTestResult(null);
    try {
      const res = await fetch(`/api/deezer/test/${deezerForm.user_id}`);
      const data = await res.json();
      setDeezerTestResult(data);
    } catch (err) {
      setDeezerTestResult({ success: false, error: err.message });
    } finally {
      setDeezerLoading(false);
    }
  };

  const handleDeezerAdd = async () => {
    if (!deezerForm.user_id) return;
    setDeezerLoading(true);
    setDeezerMessage('');
    try {
      const res = await fetch('/api/deezer/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deezerForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add account');
      setDeezerAccounts((prev) => [...prev, data]);
      setDeezerForm({ user_id: '', label: '', sync_loved: true, sync_albums: true, sync_playlists: true });
      setDeezerTestResult(null);
      setDeezerMessage('Account added!');
      setTimeout(() => setDeezerMessage(''), 3000);
    } catch (err) {
      setDeezerMessage(`Error: ${err.message}`);
    } finally {
      setDeezerLoading(false);
    }
  };

  const handleDeezerDelete = async (id) => {
    try {
      await fetch(`/api/deezer/accounts/${id}`, { method: 'DELETE' });
      setDeezerAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Failed to delete account:', err);
    }
  };

  const handleDeezerToggle = async (account, field) => {
    const updated = { ...account, [field]: !account[field] };
    try {
      const res = await fetch(`/api/deezer/accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: !account[field] }),
      });
      const data = await res.json();
      setDeezerAccounts((prev) => prev.map((a) => a.id === account.id ? data : a));
    } catch (err) {
      console.error('Failed to update account:', err);
    }
  };

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
      // Filter out masked values (***) so we don't overwrite existing keys
      const dataToSave = {};
      for (const [key, value] of Object.entries(formData)) {
        if (value !== '***') {
          dataToSave[key] = value;
        }
      }

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSave),
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

  const handleTestLastfm = async () => {
    setLoading(true);
    setTestResults(null);

    try {
      const response = await fetch('/api/settings/test-lastfm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const result = await response.json();
      setTestResults({ lastfm: result });
    } catch (error) {
      setTestResults({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestYtdlp = async () => {
    setLoading(true);
    setTestResults(null);

    try {
      const response = await fetch('/api/settings/test-ytdlp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const result = await response.json();
      setTestResults({ ytdlp: result });
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

        {/* Download Settings */}
        <div className="space-y-3">
          <h3 className="font-semibold text-white text-lg">Download Settings</h3>

          <div>
            <label className="block text-gray-300 text-sm mb-1">
              Music Output Directory
            </label>
            <input
              type="text"
              name="music_output_dir"
              placeholder="/music"
              value={formData.music_output_dir || '/music'}
              onChange={handleChange}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-300 text-sm mb-1">
              Audio Format
            </label>
            <select
              name="audio_format"
              value={formData.audio_format || 'mp3'}
              onChange={handleChange}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              <option value="mp3">MP3</option>
              <option value="flac">FLAC</option>
              <option value="opus">Opus</option>
              <option value="m4a">M4A</option>
            </select>
          </div>

          <div>
            <label className="block text-gray-300 text-sm mb-1">
              Audio Quality
            </label>
            <select
              name="audio_quality"
              value={formData.audio_quality || '320k'}
              onChange={handleChange}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              <option value="128k">128 kbps (Low)</option>
              <option value="192k">192 kbps (Medium)</option>
              <option value="256k">256 kbps (High)</option>
              <option value="320k">320 kbps (Very High)</option>
            </select>
          </div>

          <div>
            <label className="block text-gray-300 text-sm mb-1">
              Max Concurrent Downloads
            </label>
            <input
              type="number"
              name="max_concurrent_downloads"
              value={formData.max_concurrent_downloads || 2}
              onChange={handleChange}
              min="1"
              max="5"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-gray-300 text-sm mb-1">
              YouTube Search Preference
            </label>
            <select
              name="search_preference"
              value={formData.search_preference || 'auto'}
              onChange={handleChange}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              <option value="auto">Auto (Official Audio)</option>
              <option value="official_audio">Official Audio Only</option>
              <option value="lyrics">Lyrics Videos</option>
            </select>
          </div>
        </div>

        {/* Sync Settings */}
        <div className="space-y-3">
          <h3 className="font-semibold text-white text-lg">Sync Settings</h3>

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
              File Scan Interval (minutes)
            </label>
            <input
              type="number"
              name="scan_interval"
              min="1"
              max="1440"
              value={formData.scan_interval ?? 10}
              onChange={(e) => setFormData({ 
                ...formData, 
                scan_interval: parseInt(e.target.value) 
              })}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              How often LikedFM scans your music directory to detect already-downloaded 
              tracks. Minimum 1 minute, maximum 1440 (24 hours). Default: 10 minutes.
            </p>
          </div>

          <div>
            <label className="block text-gray-300 text-sm mb-1">
              Max Download Retry Attempts
            </label>
            <input
              type="number"
              name="max_retries"
              min="0"
              max="10"
              value={formData.max_retries ?? 3}
              onChange={(e) => setFormData({ 
                ...formData, 
                max_retries: parseInt(e.target.value) 
              })}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Number of times to retry a failed download before marking it as permanently failed.
              File scanner will retry missing files during each scan. Default: 3 attempts.
            </p>
          </div>

          <h4 className="font-semibold text-gray-300 text-sm mt-4">Sync Sources</h4>

          <div>
            <label className="flex items-center text-gray-300">
              <input
                type="checkbox"
                name="sync_loved"
                checked={formData.sync_loved !== false}
                onChange={handleChange}
                disabled={true}
                className="mr-3"
              />
              ❤️ Loved Tracks
              <span className="text-xs text-gray-400 ml-2">(always enabled)</span>
            </label>
          </div>

          <div>
            <label className="flex items-center text-gray-300">
              <input
                type="checkbox"
                name="sync_albums"
                checked={formData.sync_albums || false}
                onChange={handleChange}
                className="mr-3"
              />
              💿 Library Albums
            </label>
          </div>

          <div>
            <label className="flex items-center text-gray-300">
              <input
                type="checkbox"
                name="sync_playlists"
                checked={formData.sync_playlists || false}
                onChange={handleChange}
                className="mr-3"
              />
              📋 Playlists
            </label>
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
                {testResults.ytdlp && (
                  <div className={testResults.ytdlp.success ? 'text-green-400' : 'text-red-400'}>
                    <p>yt-dlp: {testResults.ytdlp.success ? '✓ Installed' : '✗ Not Found'}</p>
                    {testResults.ytdlp.version && (
                      <p className="text-xs text-gray-300">Version: {testResults.ytdlp.version}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Deezer Accounts */}
        <div className="space-y-3">
          <h3 className="font-semibold text-white text-lg">Deezer Accounts</h3>
          <p className="text-xs text-gray-400">
            Go to deezer.com, open your profile — the number in the URL is your User ID. Your profile must be set to Public.
          </p>

          {deezerMessage && (
            <div className={`p-2 rounded text-sm ${deezerMessage.includes('Error') ? 'bg-red-900 text-red-200' : 'bg-green-900 text-green-200'}`}>
              {deezerMessage}
            </div>
          )}

          {/* Saved accounts */}
          {deezerAccounts.length > 0 && (
            <div className="space-y-2">
              {deezerAccounts.map((account) => (
                <div key={account.id} className="bg-gray-700 rounded p-3 border border-gray-600">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-white font-medium">{account.label || account.user_id}</p>
                      {account.label && <p className="text-gray-400 text-xs">ID: {account.user_id}</p>}
                    </div>
                    <button
                      onClick={() => handleDeezerDelete(account.id)}
                      className="text-red-400 hover:text-red-300 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="flex gap-4 mt-2 text-sm">
                    <label className="flex items-center gap-1 text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={account.sync_loved} onChange={() => handleDeezerToggle(account, 'sync_loved')} />
                      ❤️ Loved
                    </label>
                    <label className="flex items-center gap-1 text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={account.sync_albums} onChange={() => handleDeezerToggle(account, 'sync_albums')} />
                      💿 Albums
                    </label>
                    <label className="flex items-center gap-1 text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={account.sync_playlists} onChange={() => handleDeezerToggle(account, 'sync_playlists')} />
                      📋 Playlists
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add account form */}
          <div className="bg-gray-700 rounded p-3 border border-gray-600 space-y-2">
            <p className="text-gray-300 text-sm font-medium">Add Deezer Account</p>
            <input
              type="text"
              placeholder="Deezer User ID (e.g. 123456789)"
              value={deezerForm.user_id}
              onChange={(e) => setDeezerForm({ ...deezerForm, user_id: e.target.value })}
              className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
            />
            <input
              type="text"
              placeholder="Label (optional, e.g. My Account)"
              value={deezerForm.label}
              onChange={(e) => setDeezerForm({ ...deezerForm, label: e.target.value })}
              className="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
            />
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1 text-gray-300 cursor-pointer">
                <input type="checkbox" checked={deezerForm.sync_loved} onChange={(e) => setDeezerForm({ ...deezerForm, sync_loved: e.target.checked })} />
                ❤️ Loved
              </label>
              <label className="flex items-center gap-1 text-gray-300 cursor-pointer">
                <input type="checkbox" checked={deezerForm.sync_albums} onChange={(e) => setDeezerForm({ ...deezerForm, sync_albums: e.target.checked })} />
                💿 Albums
              </label>
              <label className="flex items-center gap-1 text-gray-300 cursor-pointer">
                <input type="checkbox" checked={deezerForm.sync_playlists} onChange={(e) => setDeezerForm({ ...deezerForm, sync_playlists: e.target.checked })} />
                📋 Playlists
              </label>
            </div>
            {deezerTestResult && (
              <p className={`text-sm ${deezerTestResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {deezerTestResult.success ? `✓ Found: ${deezerTestResult.name}` : `✗ ${deezerTestResult.error}`}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleDeezerTest}
                disabled={deezerLoading || !deezerForm.user_id}
                className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white px-4 py-1.5 rounded text-sm font-semibold transition"
              >
                {deezerLoading ? 'Testing...' : 'Test'}
              </button>
              <button
                onClick={handleDeezerAdd}
                disabled={deezerLoading || !deezerForm.user_id}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-4 py-1.5 rounded text-sm font-semibold transition"
              >
                {deezerLoading ? 'Adding...' : 'Add Account'}
              </button>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 pt-4">
          <button
            onClick={handleSave}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white px-6 py-2 rounded font-semibold transition"
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>

          <button
            onClick={handleTestLastfm}
            disabled={loading}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white px-6 py-2 rounded font-semibold transition"
          >
            {loading ? 'Testing...' : 'Test Last.fm'}
          </button>

          <button
            onClick={handleTestYtdlp}
            disabled={loading}
            className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white px-6 py-2 rounded font-semibold transition"
          >
            {loading ? 'Testing...' : 'Test yt-dlp'}
          </button>
        </div>
      </div>
    </div>
  );
}
