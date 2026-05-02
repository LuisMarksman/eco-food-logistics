import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../index.css';
import { api } from '../api';
import {
  formatDateTime,
  formatDuration,
  formatDistance,
  formatFreshnessScore,
  formatShelfLife,
  freshnessClass,
  freshnessLabel,
  getStoredUser,
  routeRiskClass,
  urgencyClass,
  urgencyLabel
} from '../utils/foodDisplay';
import { analyzeRoute } from '../utils/routingClient';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const OrderPage = () => {
  const { state } = useLocation();
  const navigate = useNavigate();
  const foodItem = state?.item;
  const [receiverLocation, setReceiverLocation] = useState(state?.receiverLocation || getStoredUser()?.address || '');
  const [status, setStatus] = useState('');
  const [routeSummary, setRouteSummary] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const routeLayersRef = useRef([]);

  useEffect(() => {
    if (!foodItem || !mapRef.current || mapInstance.current) return;

    mapInstance.current = L.map(mapRef.current, {
      scrollWheelZoom: false
    }).setView([12.9716, 77.5946], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance.current);
    window.setTimeout(() => mapInstance.current?.invalidateSize(), 0);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, [foodItem]);

  const clearRouteLayers = () => {
    routeLayersRef.current.forEach((layer) => mapInstance.current?.removeLayer(layer));
    routeLayersRef.current = [];
  };

  const drawRoute = (data) => {
    const donorCoords = data.pickup.coordinates;
    const receiverCoords = data.dropoff.coordinates;
    const pickupMarker = L.marker([donorCoords.lat, donorCoords.lng]).addTo(mapInstance.current).bindPopup('Pickup');
    const dropoffMarker = L.marker([receiverCoords.lat, receiverCoords.lng]).addTo(mapInstance.current).bindPopup('Drop-off');
    const routeLayer = L.geoJSON(data.route.geometry, {
      style: {
        color: data.expiry?.canDeliverBeforeExpiry === false ? '#b42318' : data.expiry?.riskLevel === 'tight' ? '#b7791f' : '#177a62',
        opacity: 0.9,
        weight: 6
      }
    }).addTo(mapInstance.current);

    routeLayersRef.current.push(pickupMarker, dropoffMarker, routeLayer);
    mapInstance.current.invalidateSize();
    mapInstance.current.fitBounds(routeLayer.getBounds(), { padding: [25, 25] });
  };

  const handleAnalyzeRoute = async (e) => {
    e.preventDefault();
    setAnalyzing(true);
    setStatus('Analyzing route and expiry feasibility...');
    setRouteSummary(null);
    clearRouteLayers();

    try {
      const data = await analyzeRoute({
        foodItemId: foodItem._id,
        pickup: foodItem.pickupAddress || foodItem.location,
        dropoff: receiverLocation,
        expiryDate: foodItem.expiryDate
      });
      const summary = {
        ...data.route,
        expiry: data.expiry,
        freshness: data.freshness || data.allocation?.freshness,
        effectiveExpiryDate: data.effectiveExpiryDate,
        pickup: data.pickup,
        dropoff: data.dropoff
      };

      drawRoute(data);
      setRouteSummary(summary);
      setStatus(data.expiry?.canDeliverBeforeExpiry === false
        ? 'This route is likely to miss the expiry window.'
        : data.route.backendFallback
          ? 'Route is feasible. Browser fallback was used because the backend is unavailable.'
          : 'Route is feasible for this expiry window.');
    } catch (err) {
      console.error('Route analysis failed:', err);
      setStatus(err.response?.data?.message || 'Could not analyze this route.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleConfirmOrder = async () => {
    const user = getStoredUser();

    if (!user) {
      navigate('/login');
      return;
    }

    setConfirming(true);

    try {
      await api.put(`/food/claim/${foodItem._id}`, {
        receiverId: user._id,
        routeSummary
      });

      navigate('/dashboard');
    } catch (err) {
      console.error('Claim failed:', err);
      alert(err.response?.data?.message || 'Failed to confirm order.');
    } finally {
      setConfirming(false);
    }
  };

  if (!foodItem) {
    return (
      <main className="ops-page">
        <div className="empty-state order-empty">
          <h1>No order selected</h1>
          <button className="btn-primary" onClick={() => navigate('/dashboard')}>Go to dashboard</button>
        </div>
      </main>
    );
  }

  const routeCanBeClaimed = routeSummary && routeSummary.expiry?.canDeliverBeforeExpiry !== false;

  return (
    <main className="ops-page order-page">
      <section className="ops-layout order-layout">
        <aside className="ops-panel order-panel">
          <p className="eyebrow">Claim flow</p>
          <h1>Confirm route before claiming.</h1>

          <div className="order-food-summary">
            <h2>{foodItem.title}</h2>
            <p>{foodItem.pickupAddress || foodItem.location}</p>
            <div className="food-metrics-grid compact-metrics">
              <span><strong>{foodItem.quantity}</strong><small>Quantity</small></span>
              <span><strong>{foodItem.estimatedMeals || 0}</strong><small>Meals</small></span>
              <span><strong>{formatDateTime(foodItem.expiryDate)}</strong><small>Expiry</small></span>
              <span className={urgencyClass(foodItem.expiry?.urgency)}><strong>{urgencyLabel(foodItem.expiry?.urgency)}</strong><small>Urgency</small></span>
              <span className={freshnessClass(foodItem.freshness?.state)}><strong>{freshnessLabel(foodItem.freshness?.state)}</strong><small>Freshness</small></span>
              <span><strong>{formatFreshnessScore(foodItem.freshness)}</strong><small>Sensor score</small></span>
              <span><strong>{formatDateTime(foodItem.effectiveExpiryDate)}</strong><small>Delivery deadline</small></span>
            </div>
          </div>

          <form onSubmit={handleAnalyzeRoute} className="route-form">
            <label>
              Drop-off location
              <input
                type="text"
                placeholder="Receiver address or area"
                value={receiverLocation}
                onChange={(e) => setReceiverLocation(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="btn-primary" disabled={analyzing}>
              {analyzing ? 'Analyzing...' : 'Analyze route'}
            </button>
          </form>

          {status && <div className="notice">{status}</div>}

          {routeSummary && (
            <div className="route-summary-box">
              <span className={`status-pill ${routeRiskClass(routeSummary.expiry?.riskLevel)}`}>
                {routeSummary.expiry?.riskLevel || 'unknown'}
              </span>
              <div className="food-metrics-grid compact-metrics">
                <span><strong>{formatDistance(routeSummary.distanceMeters / 1000)}</strong><small>Distance</small></span>
                <span><strong>{formatDuration(routeSummary.durationSeconds)}</strong><small>Travel time</small></span>
                <span><strong>{routeSummary.provider}</strong><small>Routing</small></span>
                <span><strong>{routeSummary.fallback ? 'Fallback' : 'Road route'}</strong><small>Mode</small></span>
                <span><strong>{formatShelfLife(routeSummary.freshness?.remainingShelfLifeMinutes)}</strong><small>Fresh window</small></span>
              </div>
            </div>
          )}

          <button
            onClick={handleConfirmOrder}
            className="btn-primary confirm-btn"
            disabled={!routeCanBeClaimed || confirming}
          >
            {confirming ? 'Confirming...' : 'Confirm claim'}
          </button>
        </aside>

        <section className="map-panel route-map-shell">
          <div id="map" ref={mapRef} className="route-map" />
        </section>
      </section>
    </main>
  );
};

export default OrderPage;
