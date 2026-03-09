import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>

      {/* Footer Navigation */}
      <footer className="fixed bottom-0 left-0 right-0 bg-gray-950 border-t border-gray-800 p-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center text-sm text-gray-400">
          <div>
            LikedFM © 2024
          </div>
          <a
            href="/settings"
            className="text-blue-400 hover:text-blue-300"
          >
            ⚙️ Settings
          </a>
        </div>
      </footer>
    </Router>
  );
}

export default App;
