import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SettingsForm from '../components/SettingsForm';

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      setSettings(data);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    setTimeout(() => navigate('/'), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-white">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => navigate('/')}
            className="text-blue-400 hover:text-blue-300 flex items-center gap-2"
          >
            ← Back to Dashboard
          </button>
        </div>

        <SettingsForm
          initialSettings={settings}
          onSave={handleSave}
        />

        {/* Documentation */}
        <div className="mt-8 bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold mb-4">Need Help?</h3>
          <ul className="space-y-2 text-sm text-gray-400">
            <li>
              <a
                href="https://www.last.fm/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Get Last.fm API credentials →
              </a>
            </li>
            <li>
              <a
                href="https://wiki.servarr.com/lidarr/settings/general#security"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Find your Lidarr API key →
              </a>
            </li>
            <li className="text-gray-500">
              Music Root Path should match your Lidarr root folder path
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
