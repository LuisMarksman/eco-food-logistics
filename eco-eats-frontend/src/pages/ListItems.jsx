import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../index.css';
import { api } from '../api';
import {
  CATEGORY_OPTIONS,
  EXPIRY_FILTERS,
  SORT_OPTIONS,
  formatDateTime,
  formatDistance,
  formatFreshnessScore,
  freshnessClass,
  freshnessLabel,
  getStoredUser,
  urgencyClass,
  urgencyLabel
} from '../utils/foodDisplay';
import { geocodeLocation } from '../utils/routingClient';

const defaultFilters = {
  q: '',
  category: '',
  expiresWithinHours: '',
  sort: 'bestmatch',
  radiusKm: '10',
  receiverLocation: ''
};

const FoodResultCard = ({ item, onClaim }) => (
  <article className="ops-card food-result-card">
    <div className="food-result-main">
      <div className="food-card-header">
        <div>
          <p className="eyebrow">{item.category || 'general'}</p>
          <h3>{item.title}</h3>
        </div>
        <span className={`status-pill ${urgencyClass(item.expiry?.urgency)}`}>
          {urgencyLabel(item.expiry?.urgency)}
        </span>
        <span className={`status-pill ${freshnessClass(item.freshness?.state)}`}>
          {freshnessLabel(item.freshness?.state)}
        </span>
      </div>

      <p className="food-description">{item.description || 'No description provided.'}</p>

      <div className="food-metrics-grid">
        <span><strong>{item.quantity}</strong><small>Quantity</small></span>
        <span><strong>{item.estimatedMeals || 0}</strong><small>Meals</small></span>
        <span><strong>{formatDistance(item.distanceKm)}</strong><small>Pickup distance</small></span>
        <span><strong>{item.allocationScore ?? '-'}</strong><small>Match score</small></span>
        <span><strong>{formatFreshnessScore(item.freshness)}</strong><small>Freshness</small></span>
      </div>
    </div>

    <div className="food-result-side">
      <p><strong>Pickup</strong>{item.pickupAddress || item.location}</p>
      <p><strong>Expires</strong>{formatDateTime(item.expiryDate)}</p>
      <p><strong>Delivery deadline</strong>{formatDateTime(item.effectiveExpiryDate)}</p>
      <button className="btn-primary" onClick={() => onClaim(item)}>Check route</button>
    </div>
  </article>
);

const ListItems = () => {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(defaultFilters);
  const [receiverCoords, setReceiverCoords] = useState(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const updateFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
  };

  useEffect(() => {
    const controller = new AbortController();

    const fetchFood = async () => {
      setLoading(true);
      setError('');

      try {
        const res = await api.get('/food', {
          params: {
            q: filters.q || undefined,
            category: filters.category || undefined,
            expiresWithinHours: filters.expiresWithinHours || undefined,
            sort: filters.sort,
            radiusKm: receiverCoords ? filters.radiusKm : undefined,
            lat: receiverCoords?.lat,
            lng: receiverCoords?.lng
          },
          signal: controller.signal
        });
        setItems(res.data);
      } catch (err) {
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;
        console.error('Error fetching food:', err);
        setError('Failed to load food items. Please ensure the backend is running.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    const searchDelay = setTimeout(fetchFood, 250);

    return () => {
      clearTimeout(searchDelay);
      controller.abort();
    };
  }, [filters, receiverCoords]);

  const handleUseLocation = async () => {
    if (!filters.receiverLocation.trim()) {
      setReceiverCoords(null);
      setLocationStatus('');
      return;
    }

    setLocationStatus('Resolving location...');

    try {
      const data = await geocodeLocation(filters.receiverLocation);
      setReceiverCoords(data.coordinates);
      setLocationStatus(`Using ${data.displayName || filters.receiverLocation}`);
    } catch (err) {
      console.error('Location lookup failed:', err);
      setReceiverCoords(null);
      setLocationStatus('Could not resolve that location.');
    }
  };

  const handleClaim = (item) => {
    const user = getStoredUser();

    if (!user) {
      navigate('/login');
      return;
    }

    if (user.role !== 'receiver') {
      alert('Only receivers can claim food. Please login as a receiver.');
      return;
    }

    navigate('/order', {
      state: {
        item,
        receiverLocation: filters.receiverLocation
      }
    });
  };

  return (
    <main className="ops-page">
      <section className="ops-hero compact-hero">
        <div>
          <p className="eyebrow">Receiver workspace</p>
          <h1>Find the surplus that can still become meals.</h1>
          <p>
            Search available food by urgency, distance, category, and backend match score.
          </p>
        </div>
      </section>

      <section className="ops-layout search-layout">
        <aside className="ops-panel filter-panel">
          <h2>Search filters</h2>
          <label>
            Keyword
            <input
              value={filters.q}
              onChange={(e) => updateFilter('q', e.target.value)}
              placeholder="Rice, bakery, Indiranagar..."
            />
          </label>

          <label>
            Receiver location
            <input
              value={filters.receiverLocation}
              onChange={(e) => updateFilter('receiverLocation', e.target.value)}
              placeholder="NGO address or area"
            />
          </label>
          <button className="btn-secondary" type="button" onClick={handleUseLocation}>
            Use location
          </button>
          {locationStatus && <p className="helper-text">{locationStatus}</p>}

          <div className="filter-grid">
            <label>
              Category
              <select value={filters.category} onChange={(e) => updateFilter('category', e.target.value)}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label>
              Expiry
              <select value={filters.expiresWithinHours} onChange={(e) => updateFilter('expiresWithinHours', e.target.value)}>
                {EXPIRY_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label>
              Sort
              <select value={filters.sort} onChange={(e) => updateFilter('sort', e.target.value)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label>
              Radius
              <select value={filters.radiusKm} onChange={(e) => updateFilter('radiusKm', e.target.value)}>
                <option value="5">5 km</option>
                <option value="10">10 km</option>
                <option value="25">25 km</option>
                <option value="50">50 km</option>
              </select>
            </label>
          </div>
        </aside>

        <section className="results-panel">
          <div className="section-header">
            <div>
              <p className="eyebrow">Live allocation queue</p>
              <h2>{items.length} available matches</h2>
            </div>
            {loading && <span className="status-pill risk-low">Loading</span>}
          </div>

          {error && <div className="notice error-notice">{error}</div>}

          {!loading && items.length === 0 ? (
            <div className="empty-state">
              <h3>No matches found</h3>
              <p>Try widening the expiry window, radius, or category.</p>
            </div>
          ) : (
            <div className="food-results-list">
              {items.map((item) => (
                <FoodResultCard key={item._id} item={item} onClaim={handleClaim} />
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
};

export default ListItems;
