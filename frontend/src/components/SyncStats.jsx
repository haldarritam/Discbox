export default function SyncStats({ stats, selectedAccounts, onToggleAccount }) {
  const statItems = [
    { label: 'Total', value: stats?.total || 0, color: 'from-blue-600 to-blue-700' },
    { label: 'Pending', value: stats?.status?.pending || 0, color: 'from-gray-600 to-gray-700' },
    { label: 'Downloaded', value: stats?.status?.downloaded || 0, color: 'from-green-600 to-green-700' },
    { label: 'Failed', value: stats?.status?.failed || 0, color: 'from-red-600 to-red-700' },
  ];

  const accountEntries = Object.entries(stats?.byAccount || {});

  return (
    <div className="mb-6 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statItems.map((item) => (
          <div key={item.label} className={`bg-gradient-to-br ${item.color} rounded-lg p-4 text-white`}>
            <p className="text-sm text-gray-200">{item.label}</p>
            <p className="text-3xl font-bold mt-1">{item.value}</p>
          </div>
        ))}
      </div>

      {accountEntries.length > 0 && (
        <div className="flex gap-3 flex-wrap items-center">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Filter by user:</span>
          {accountEntries.map(([label, count]) => {
            const isSelected = selectedAccounts.includes(label);
            return (
              <button
                key={label}
                onClick={() => onToggleAccount(label)}
                className={`rounded-lg px-4 py-2 flex items-center gap-2 text-sm font-medium transition border ${
                  isSelected
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                <span>👤 {label}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-indigo-500' : 'bg-gray-700'}`}>
                  {count}
                </span>
              </button>
            );
          })}
          {selectedAccounts.length > 0 && (
            <button
              onClick={() => onToggleAccount(null)}
              className="text-xs text-gray-500 hover:text-gray-300 transition underline"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
