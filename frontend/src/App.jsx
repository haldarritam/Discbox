import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';

function App() {
  return (
    <Router>
      <div>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>

        <a
          href="/settings"
          className="fixed bottom-6 right-6 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition z-50"
          title="Settings"
        >
          ⚙️
        </a>
      </div>
    </Router>
  );
}

export default App;
