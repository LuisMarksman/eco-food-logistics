import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../index.css';
import { api } from '../api';
import {
  formatDateTime,
  formatDuration,
  formatDistance,
  formatFreshnessScore,
  freshnessClass,
  freshnessLabel,
  getStoredUser,
  routeRiskClass,
  urgencyClass,
  urgencyLabel
} from '../utils/foodDisplay';
import { analyzeRoute, geocodeLocation } from '../utils/routingClient';

const DEFAULT_MAP_CENTER = [12.9716, 77.5946];

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const normalizeCoords = (coords) => {
  const lat = Number(coords?.lat ?? coords?.latitude);
  const lng = Number(coords?.lng ?? coords?.lon ?? coords?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const foodKey = (item) => item?._id || `${item?.title}-${item?.pickupAddress || item?.location}`;

const coordinatesForFood = (item) => normalizeCoords(item?.pickupCoordinates);

const pickupLabel = (item) => item?.pickupAddress || item?.location || '';

const routeColor = (data) => {
  if (data?.expiry?.canDeliverBeforeExpiry === false) return '#b42318';
  if (data?.route?.fallback) return '#b7791f';
  return '#177a62';
};

const pinRiskClassForFood = (item = {}) => {
  const urgency = urgencyClass(item.expiry?.urgency);
  const freshness = freshnessClass(item.freshness?.state);

  if (urgency === 'risk-high' || freshness === 'risk-high') return 'pin-risk-high';
  if (urgency === 'risk-medium' || freshness === 'risk-medium') return 'pin-risk-medium';
  return 'pin-risk-low';
};

const createFoodPinIcon = (item, isActive) => L.divIcon({
  className: `pickup-option-marker ${isActive ? 'active' : ''} ${pinRiskClassForFood(item)}`,
  html: `
    <span class="pickup-pin-dot"></span>
    <span class="pickup-pin-preview">
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.estimatedMeals || 0)} meals - ${escapeHtml(freshnessLabel(item.freshness?.state))}</small>
    </span>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 38],
  popupAnchor: [0, -38]
});

const createReceiverIcon = () => L.divIcon({
  className: 'pickup-option-marker receiver-home active',
  html: `
    <span class="pickup-pin-dot"></span>
    <span class="pickup-pin-preview">
      <strong>Receiver drop-off</strong>
      <small>Route destination</small>
    </span>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 38],
  popupAnchor: [0, -38]
});

const FoodPinCard = ({ item, isActive, onSelect }) => (
  <article className={`route-food-card ${isActive ? 'active-route-food-card' : ''}`} onClick={onSelect}>
    <div>
      <p className="eyebrow">{item.category || 'general'}</p>
      <h3>{item.title}</h3>
      <p>{pickupLabel(item)}</p>
    </div>
    <div className="route-food-meta">
      <span className={`status-pill ${urgencyClass(item.expiry?.urgency)}`}>{urgencyLabel(item.expiry?.urgency)}</span>
      <span className={`status-pill ${freshnessClass(item.freshness?.state)}`}>{freshnessLabel(item.freshness?.state)}</span>
      <small>{item.estimatedMeals || 0} meals</small>
      <small>{formatDistance(item.distanceKm)}</small>
    </div>
  </article>
);

const RouteAnalyzer = () => {
  const storedUser = useMemo(() => getStoredUser(), []);
  const [form, setForm] = useState({
    pickup: '',
    dropoff: storedUser?.role === 'receiver' ? storedUser.address || '' : '',
    expiryDate: ''
  });
  const [status, setStatus] = useState('');
  const [pinStatus, setPinStatus] = useState('Loading available pickup pins...');
  const [routeResult, setRouteResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingPins, setLoadingPins] = useState(false);
  const [foodItems, setFoodItems] = useState([]);
  const [activeFoodId, setActiveFoodId] = useState('');
  const [receiverPoint, setReceiverPoint] = useState(null);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const routeLayersRef = useRef([]);
  const pinLayersRef = useRef([]);

  const activeFood = useMemo(
    () => (activeFoodId ? foodItems.find((item) => foodKey(item) === activeFoodId) || null : null),
    [activeFoodId, foodItems]
  );

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const clearRouteLayers = () => {
    routeLayersRef.current.forEach((layer) => mapInstance.current?.removeLayer(layer));
    routeLayersRef.current = [];
  };

  const clearPinLayers = () => {
    pinLayersRef.current.forEach((layer) => mapInstance.current?.removeLayer(layer));
    pinLayersRef.current = [];
  };

  const selectFood = useCallback((item) => {
    if (!item) return;

    setActiveFoodId(foodKey(item));
    setForm((current) => ({
      ...current,
      pickup: pickupLabel(item),
      expiryDate: item.expiryDate
        ? new Date(new Date(item.expiryDate).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : current.expiryDate
    }));
    setStatus(`${item.title} selected. Add or confirm a drop-off location, then analyze the route.`);
  }, []);

  const drawPickupPins = useCallback(() => {
    if (!mapInstance.current) return;

    clearPinLayers();
    const bounds = [];

    foodItems.forEach((item) => {
      const coords = coordinatesForFood(item);
      if (!coords) return;

      const isActive = foodKey(item) === activeFoodId;
      const marker = L.marker([coords.lat, coords.lng], {
        icon: createFoodPinIcon(item, isActive),
        zIndexOffset: isActive ? 700 : 100
      })
        .bindPopup(
          `<strong>${escapeHtml(item.title)}</strong><br>`
          + `${escapeHtml(pickupLabel(item))}<br>`
          + `${escapeHtml(item.quantity)} - ${escapeHtml(formatFreshnessScore(item.freshness))}<br>`
          + `Expires ${escapeHtml(formatDateTime(item.expiryDate))}`
        )
        .on('click', () => {
          selectFood(item);
          marker.openPopup();
        });

      marker.addTo(mapInstance.current);
      pinLayersRef.current.push(marker);
      bounds.push([coords.lat, coords.lng]);
    });

    const receiverCoords = normalizeCoords(receiverPoint?.coordinates);
    if (receiverCoords) {
      const receiverMarker = L.marker([receiverCoords.lat, receiverCoords.lng], {
        icon: createReceiverIcon(),
        zIndexOffset: 500
      }).bindPopup(`<strong>Receiver drop-off</strong><br>${escapeHtml(receiverPoint.displayName || receiverPoint.address || form.dropoff)}`);

      receiverMarker.addTo(mapInstance.current);
      pinLayersRef.current.push(receiverMarker);
      bounds.push([receiverCoords.lat, receiverCoords.lng]);
    }

    mapInstance.current.invalidateSize();
    if (bounds.length > 0) {
      mapInstance.current.fitBounds(bounds, { padding: [34, 34], maxZoom: 13 });
    } else {
      mapInstance.current.setView(DEFAULT_MAP_CENTER, 12);
    }
  }, [activeFoodId, foodItems, form.dropoff, receiverPoint, selectFood]);

  useEffect(() => {
    if (mapRef.current && !mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, { scrollWheelZoom: false }).setView(DEFAULT_MAP_CENTER, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(mapInstance.current);
      window.setTimeout(() => mapInstance.current?.invalidateSize(), 0);
    }

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    drawPickupPins();
  }, [drawPickupPins]);

  const loadPickupPins = useCallback(async ({ resolveReceiver = false } = {}) => {
    setLoadingPins(true);
    setPinStatus('Loading available pickup pins...');

    try {
      let nextReceiverPoint = receiverPoint;

      if (resolveReceiver && form.dropoff.trim()) {
        nextReceiverPoint = await geocodeLocation(form.dropoff.trim());
        setReceiverPoint(nextReceiverPoint);
      }

      const receiverCoords = normalizeCoords(nextReceiverPoint?.coordinates);
      const res = await api.get('/food', {
        params: {
          sort: receiverCoords ? 'distance' : 'bestmatch',
          radiusKm: receiverCoords ? 25 : undefined,
          lat: receiverCoords?.lat,
          lng: receiverCoords?.lng
        }
      });
      const mappedItems = Array.isArray(res.data) ? res.data.filter((item) => coordinatesForFood(item)) : [];
      const selectedItem = mappedItems.find((item) => foodKey(item) === activeFoodId) || mappedItems[0] || null;

      setFoodItems(mappedItems);
      setActiveFoodId(selectedItem ? foodKey(selectedItem) : '');
      if (selectedItem && !form.pickup) {
        setForm((current) => ({
          ...current,
          pickup: pickupLabel(selectedItem),
          expiryDate: selectedItem.expiryDate
            ? new Date(new Date(selectedItem.expiryDate).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
            : current.expiryDate
        }));
      }
      setPinStatus(mappedItems.length
        ? `${mappedItems.length} pickup location${mappedItems.length === 1 ? '' : 's'} pinned on the map.`
        : 'No pickup locations with coordinates are available right now.');
    } catch (err) {
      console.error('Pickup pin load failed:', err);
      setFoodItems([]);
      setActiveFoodId('');
      setPinStatus(err.response?.data?.message || 'Could not load pickup locations.');
    } finally {
      setLoadingPins(false);
    }
  }, [activeFoodId, form.dropoff, form.pickup, receiverPoint]);

  useEffect(() => {
    loadPickupPins({ resolveReceiver: Boolean(form.dropoff.trim()) });
    // Run once on entry; manual refresh handles later destination changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drawRoute = (data) => {
    clearRouteLayers();

    const startCoords = data.pickup.coordinates;
    const endCoords = data.dropoff.coordinates;
    const startMarker = L.marker([startCoords.lat, startCoords.lng], {
      icon: createFoodPinIcon(activeFood || { title: 'Pickup', estimatedMeals: 0, freshness: {} }, true),
      zIndexOffset: 900
    }).addTo(mapInstance.current).bindPopup('Selected pickup').openPopup();
    const endMarker = L.marker([endCoords.lat, endCoords.lng], {
      icon: createReceiverIcon(),
      zIndexOffset: 800
    }).addTo(mapInstance.current).bindPopup('Drop-off');
    const routeLayer = L.geoJSON(data.route.geometry, {
      style: {
        color: routeColor(data),
        opacity: 0.9,
        weight: 6
      }
    }).addTo(mapInstance.current);

    routeLayersRef.current.push(startMarker, endMarker, routeLayer);
    mapInstance.current.invalidateSize();
    mapInstance.current.fitBounds(routeLayer.getBounds(), { padding: [25, 25] });
  };

  const handleAnalyze = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus('Analyzing route...');
    setRouteResult(null);

    try {
      const data = await analyzeRoute({
        foodItemId: activeFood?._id,
        pickup: activeFood?._id
          ? { address: pickupLabel(activeFood), coordinates: activeFood.pickupCoordinates }
          : form.pickup,
        dropoff: form.dropoff,
        expiryDate: form.expiryDate || activeFood?.expiryDate || undefined
      });

      drawRoute(data);
      setRouteResult(data);
      setStatus(data.expiry?.canDeliverBeforeExpiry === false
        ? 'Route found, but expiry timing is risky.'
        : data.route.backendFallback
          ? 'Route found using browser fallback because the backend is unavailable.'
          : 'Route found and ready to review.');
    } catch (err) {
      console.error('Route analysis error:', err);
      setStatus(err.response?.data?.message || 'Could not find one of the locations.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="ops-page route-analyzer-page">
      <section className="ops-hero compact-hero">
        <div>
          <p className="eyebrow">Route analyser</p>
          <h1>Explore pickup points before food is claimed.</h1>
          <p>
            Receiver-ready pins show available pickup locations, freshness, meals, expiry, and route feasibility.
          </p>
        </div>
      </section>

      <section className="ops-layout order-layout route-discovery-layout">
        <aside className="ops-panel order-panel route-discovery-panel">
          <form onSubmit={handleAnalyze} className="route-form">
            <label>
              Receiver drop-off
              <input
                type="text"
                placeholder="Receiver address or demand center"
                value={form.dropoff}
                onChange={(e) => updateForm('dropoff', e.target.value)}
                required
              />
            </label>
            <div className="route-discovery-actions">
              <button type="button" className="btn-secondary" onClick={() => loadPickupPins({ resolveReceiver: true })} disabled={loadingPins || !form.dropoff.trim()}>
                {loadingPins ? 'Loading pins...' : 'Refresh pickup pins'}
              </button>
              {storedUser?.role === 'receiver' && storedUser.address && (
                <button type="button" className="btn-secondary" onClick={() => updateForm('dropoff', storedUser.address)}>
                  Use profile address
                </button>
              )}
            </div>

            <label>
              Selected pickup
              <input
                type="text"
                placeholder="Click a pickup pin or enter an address"
                value={form.pickup}
                onChange={(e) => {
                  updateForm('pickup', e.target.value);
                  setActiveFoodId('');
                }}
                required
              />
            </label>
            <label>
              Expiry time
              <input
                type="datetime-local"
                value={form.expiryDate}
                onChange={(e) => updateForm('expiryDate', e.target.value)}
              />
            </label>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Analyzing...' : 'Analyze selected route'}
            </button>
          </form>

          {pinStatus && <div className="notice">{pinStatus}</div>}
          {status && <div className="notice">{status}</div>}

          {activeFood && (
            <div className="selected-pickup-box">
              <p className="eyebrow">Selected pickup</p>
              <h2>{activeFood.title}</h2>
              <p>{pickupLabel(activeFood)}</p>
              <div className="food-metrics-grid compact-metrics">
                <span><strong>{activeFood.estimatedMeals || 0}</strong><small>Meals</small></span>
                <span><strong>{formatFreshnessScore(activeFood.freshness)}</strong><small>Freshness</small></span>
                <span><strong>{formatDateTime(activeFood.expiryDate)}</strong><small>Expires</small></span>
                <span><strong>{formatDistance(activeFood.distanceKm)}</strong><small>Distance</small></span>
              </div>
            </div>
          )}

          {routeResult && (
            <div className="route-summary-box">
              <span className={`status-pill ${routeRiskClass(routeResult.expiry?.riskLevel)}`}>
                {routeResult.expiry?.riskLevel || 'unknown'}
              </span>
              <div className="food-metrics-grid compact-metrics">
                <span><strong>{formatDistance(routeResult.route.distanceMeters / 1000)}</strong><small>Distance</small></span>
                <span><strong>{formatDuration(routeResult.route.durationSeconds)}</strong><small>Travel time</small></span>
                <span><strong>{routeResult.route.provider}</strong><small>Provider</small></span>
                <span><strong>{routeResult.route.fallback ? 'Fallback' : 'Road route'}</strong><small>Mode</small></span>
              </div>
            </div>
          )}
        </aside>

        <section className="map-panel route-map-shell route-pickup-map-shell">
          <div id="map" ref={mapRef} className="route-map" />
          {foodItems.length === 0 && (
            <div className="route-map-empty">
              <strong>No pickup pins yet.</strong>
              <span>Available food with coordinates will appear here.</span>
            </div>
          )}
        </section>

        <section className="ops-card route-food-list-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Pickup options</p>
              <h2>{foodItems.length} mapped locations</h2>
            </div>
          </div>
          <div className="route-food-list">
            {foodItems.map((item) => (
              <FoodPinCard
                key={foodKey(item)}
                item={item}
                isActive={foodKey(item) === foodKey(activeFood)}
                onSelect={() => selectFood(item)}
              />
            ))}
            {foodItems.length === 0 && <div className="empty-state compact-empty">No mapped pickup options yet.</div>}
          </div>
        </section>
      </section>
    </main>
  );
};

export default RouteAnalyzer;
