export default function StatusBadge({ status }) {
  const statusConfig = {
    pending: {
      bg: 'bg-gray-700',
      text: 'text-gray-300',
      label: 'Pending',
    },
    requested: {
      bg: 'bg-amber-700',
      text: 'text-amber-300',
      label: 'Requested',
    },
    downloaded: {
      bg: 'bg-green-700',
      text: 'text-green-300',
      label: 'Downloaded',
    },
    ignored: {
      bg: 'bg-red-900',
      text: 'text-red-400',
      label: 'Ignored',
    },
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}
