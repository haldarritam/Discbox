export default function SyncStats({ stats }) {
  const statItems = [
    { label: 'Total', value: stats?.total || 0, color: 'from-blue-600 to-blue-700' },
    { label: 'Pending', value: stats?.pending || 0, color: 'from-gray-600 to-gray-700' },
    { label: 'Requested', value: stats?.requested || 0, color: 'from-amber-600 to-amber-700' },
    { label: 'Downloaded', value: stats?.downloaded || 0, color: 'from-green-600 to-green-700' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {statItems.map((item) => (
        <div
          key={item.label}
          className={`bg-gradient-to-br ${item.color} rounded-lg p-4 text-white`}
        >
          <p className="text-sm text-gray-200">{item.label}</p>
          <p className="text-3xl font-bold mt-1">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
