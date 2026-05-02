export const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'general', label: 'General' },
  { value: 'prepared-meals', label: 'Prepared meals' },
  { value: 'produce', label: 'Produce' },
  { value: 'bakery', label: 'Bakery' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'packaged', label: 'Packaged' }
];

export const EXPIRY_FILTERS = [
  { value: '', label: 'Any expiry' },
  { value: '4', label: 'Next 4h' },
  { value: '12', label: 'Next 12h' },
  { value: '24', label: 'Next 24h' },
  { value: '48', label: 'Next 48h' }
];

export const SORT_OPTIONS = [
  { value: 'bestmatch', label: 'Best match' },
  { value: 'expiry', label: 'Expiry first' },
  { value: 'distance', label: 'Nearest' },
  { value: 'meals', label: 'Most meals' }
];

export function getStoredUser() {
  const storedUser = localStorage.getItem('user');
  return storedUser ? JSON.parse(storedUser) : null;
}

export function formatDateTime(value) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

export function formatDistance(km) {
  if (typeof km !== 'number') return 'Distance unknown';
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}

export function formatDuration(seconds) {
  if (!seconds) return 'Time unknown';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

export function urgencyLabel(urgency) {
  const labels = {
    critical: 'Critical',
    urgent: 'Urgent',
    soon: 'Soon',
    stable: 'Stable',
    expired: 'Expired',
    unknown: 'Unknown'
  };

  return labels[urgency] || 'Unknown';
}

export function urgencyClass(urgency) {
  if (urgency === 'critical' || urgency === 'expired') return 'risk-high';
  if (urgency === 'urgent' || urgency === 'soon') return 'risk-medium';
  return 'risk-low';
}

export function freshnessLabel(state) {
  const labels = {
    excellent: 'Excellent',
    good: 'Good',
    watch: 'Watch',
    critical: 'Critical',
    unsafe: 'Unsafe',
    unknown: 'No sensor'
  };

  return labels[state] || 'No sensor';
}

export function freshnessClass(state) {
  if (state === 'unsafe' || state === 'critical') return 'risk-high';
  if (state === 'watch') return 'risk-medium';
  return 'risk-low';
}

export function formatFreshnessScore(freshness) {
  if (!freshness || freshness.score === null || freshness.score === undefined) return 'No sensor';
  return `${freshness.score}/100`;
}

export function formatShelfLife(minutes) {
  if (minutes === null || minutes === undefined) return 'Unknown';
  if (minutes <= 0) return 'Now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

export function routeRiskClass(riskLevel) {
  if (riskLevel === 'misses_expiry' || riskLevel === 'expired' || riskLevel === 'freshness_critical') return 'risk-high';
  if (riskLevel === 'tight' || riskLevel === 'freshness_watch') return 'risk-medium';
  return 'risk-low';
}

export function statusLabel(item) {
  if (item.status) return item.status.charAt(0).toUpperCase() + item.status.slice(1);
  return item.isAvailable ? 'Available' : 'Claimed';
}

export function totalMeals(items) {
  return items.reduce((sum, item) => sum + (Number(item.estimatedMeals) || 0), 0);
}

export function totalKg(items) {
  return items.reduce((sum, item) => {
    const quantity = Number.parseFloat(item.quantity);
    return sum + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}
