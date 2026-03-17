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
                href="https://www.deezer.com/profile"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Find your Deezer profile ID → (number in your profile URL)
              </a>
            </li>
            <li>
              <a
                href="https://www.last.fm/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Get Last.fm API credentials → (optional)
              </a>
            </li>
            <li>
              <a
                href="https://github.com/haldarritam/Discbox"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Discbox on GitHub →
              </a>
            </li>
            <li className="text-gray-500">
              Your Deezer profile must be set to <strong className="text-gray-300">Public</strong> for sync to work
            </li>
            <li className="text-gray-500">
              Music Output Dir is the path inside the container — default is <code className="text-gray-300">/music</code>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
