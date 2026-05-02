import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '../index.css';
import { api } from '../api';
import {
  CATEGORY_OPTIONS,
  formatDateTime,
  formatDuration,
  formatDistance,
  formatFreshnessScore,
  formatShelfLife,
  freshnessClass,
  freshnessLabel,
  getStoredUser,
  routeRiskClass,
  statusLabel,
  totalKg,
  totalMeals,
  urgencyClass,
  urgencyLabel
} from '../utils/foodDisplay';
import { geocodeLocation } from '../utils/routingClient';

const DEFAULT_MAP_CENTER = [12.9716, 77.5946];
const OPERATIONS_REFRESH_MS = 20000;

const profileFromUser = (user) => ({
  address: user?.address || '',
  phone: user?.phone || '',
  organization: user?.organization || ''
});

const initialFoodData = {
  title: '',
  quantity: '',
  location: '',
  expiryDate: '',
  category: 'general',
  description: '',
  deviceId: '',
  temperatureC: '',
  humidityPct: '',
  gasLevel: ''
};

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

const routeKey = (entry) => {
  if (!entry) return '';
  const itemId = entry.foodItem?._id || entry.foodItem?.title || 'food';
  const targetId = entry.demandCenter?._id || entry.receiver?.address || entry.receiver?.displayName || 'receiver';
  return `${entry.kind || 'route'}-${itemId}-${targetId}`;
};

const pickupCoordsForRoute = (entry) => (
  normalizeCoords(entry?.foodItem?.pickupCoordinates)
  || normalizeCoords(entry?.routeSummary?.pickup?.coordinates)
);

const destinationForRoute = (entry) => entry?.demandCenter || entry?.receiver || entry?.routeSummary?.dropoff || {};

const destinationCoordsForRoute = (entry) => (
  normalizeCoords(entry?.demandCenter?.coordinates)
  || normalizeCoords(entry?.receiver?.coordinates)
  || normalizeCoords(entry?.routeSummary?.dropoff?.coordinates)
);

const destinationLabel = (entry, isDonor) => {
  const destination = destinationForRoute(entry);
  if (destination.name) return destination.name;
  if (destination.displayName) return destination.displayName;
  if (destination.address) return destination.address;
  return isDonor ? 'Demand center' : 'Your address';
};

const destinationAddress = (entry) => {
  const destination = destinationForRoute(entry);
  return destination.address || destination.displayName || '';
};

const routeRisk = (entry) => (
  entry?.expiry?.riskLevel
  || entry?.allocation?.risk
  || entry?.allocation?.feasibility?.riskLevel
  || entry?.route?.expiryRisk
  || 'unknown'
);

const routeStrokeColor = (entry) => {
  const riskClass = routeRiskClass(routeRisk(entry));
  if (riskClass === 'risk-high') return '#b42318';
  if (riskClass === 'risk-medium') return '#b7791f';
  if (entry?.route?.fallback) return '#245f93';
  if (entry?.kind === 'claimed') return '#245f93';
  return '#177a62';
};

const formatRefreshTime = (date) => {
  if (!date) return 'Not refreshed yet';
  return `Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

const routeDistanceKm = (entry) => (
  typeof entry?.route?.distanceMeters === 'number' ? entry.route.distanceMeters / 1000 : null
);

const claimedRouteFromItem = (item) => {
  const summary = item.routeSummary;
  const pickup = normalizeCoords(summary?.pickup?.coordinates) || normalizeCoords(item.pickupCoordinates);
  const dropoff = normalizeCoords(summary?.dropoff?.coordinates);

  if (!summary?.geometry || !pickup || !dropoff) return null;

  return {
    kind: 'claimed',
    foodItem: {
      ...item,
      pickupCoordinates: pickup
    },
    receiver: {
      address: summary.dropoff?.address || 'Receiver drop-off',
      displayName: summary.dropoff?.displayName || summary.dropoff?.address || 'Receiver drop-off',
      coordinates: dropoff
    },
    route: {
      provider: summary.provider,
      fallback: summary.fallback,
      distanceMeters: summary.distanceMeters,
      durationSeconds: summary.durationSeconds,
      geometry: summary.geometry
    },
    expiry: {
      riskLevel: summary.expiryRisk || item.allocationRisk
    },
    allocation: {
      score: item.allocationScore ?? 0,
      freshness: item.freshness,
      effectiveExpiryDate: summary.effectiveExpiryDate || item.effectiveExpiryDate,
      reason: 'Claimed route captured at receiver confirmation.'
    }
  };
};

const foodForClaim = (entry) => ({
  ...entry.foodItem,
  expiry: entry.allocation?.expiry || entry.foodItem?.expiry,
  freshness: entry.allocation?.freshness || entry.foodItem?.freshness,
  effectiveExpiryDate: entry.allocation?.effectiveExpiryDate || entry.foodItem?.effectiveExpiryDate,
  allocationScore: entry.allocation?.score ?? entry.foodItem?.allocationScore,
  distanceKm: routeDistanceKm(entry)
});

const createPinIcon = (kind, isActive, risk) => L.divIcon({
  className: `live-map-icon ${kind} ${isActive ? 'active' : ''} ${routeRiskClass(risk)}`,
  html: '<span></span>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -17]
});

const OperationsMap = ({ routes, activeRouteKey, role, onSelectRoute }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const layersRef = useRef([]);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return undefined;

    mapInstance.current = L.map(mapRef.current, {
      zoomControl: true,
      scrollWheelZoom: false
    }).setView(DEFAULT_MAP_CENTER, 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(mapInstance.current);

    window.setTimeout(() => mapInstance.current?.invalidateSize(), 0);

    return () => {
      mapInstance.current?.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;

    layersRef.current.forEach((layer) => mapInstance.current?.removeLayer(layer));
    layersRef.current = [];

    const activeRoute = routes.find((entry) => routeKey(entry) === activeRouteKey) || routes[0];
    const allBounds = [];
    const destinationMarkers = new Set();
    let activeLayer = null;

    routes.forEach((entry, index) => {
      const key = routeKey(entry);
      const isActive = key === routeKey(activeRoute);
      const pickup = pickupCoordsForRoute(entry);
      const destination = destinationCoordsForRoute(entry);
      const risk = routeRisk(entry);
      const opacity = isActive ? 0.92 : 0.28;

      if (entry.route?.geometry) {
        const routeLayer = L.geoJSON(entry.route.geometry, {
          style: {
            color: routeStrokeColor(entry),
            opacity,
            weight: isActive ? 6 : 4
          }
        }).on('click', () => onSelectRoute(key));

        routeLayer.addTo(mapInstance.current);
        layersRef.current.push(routeLayer);
        if (isActive) activeLayer = routeLayer;

        const bounds = routeLayer.getBounds();
        if (bounds?.isValid()) {
          allBounds.push(bounds.getSouthWest(), bounds.getNorthEast());
        }
      }

      if (pickup) {
        const pickupMarker = L.marker([pickup.lat, pickup.lng], {
          icon: createPinIcon('pickup-pin', isActive, risk),
          zIndexOffset: isActive ? 800 : 200
        })
          .bindPopup(
            `<strong>${escapeHtml(entry.foodItem?.title || `Food option ${index + 1}`)}</strong><br>`
            + `${escapeHtml(entry.foodItem?.pickupAddress || entry.foodItem?.location)}<br>`
            + `Score ${escapeHtml(entry.allocation?.score ?? '--')} - ${escapeHtml(formatDuration(entry.route?.durationSeconds))}`
          )
          .on('click', () => onSelectRoute(key));

        pickupMarker.addTo(mapInstance.current);
        layersRef.current.push(pickupMarker);
        allBounds.push([pickup.lat, pickup.lng]);
      }

      if (destination) {
        const markerKey = `${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}-${destinationLabel(entry, role === 'donor')}`;

        if (!destinationMarkers.has(markerKey)) {
          destinationMarkers.add(markerKey);

          const destinationMarker = L.marker([destination.lat, destination.lng], {
            icon: createPinIcon(role === 'donor' ? 'destination-pin' : 'receiver-pin', isActive, risk),
            zIndexOffset: isActive ? 700 : 100
          })
            .bindPopup(
              `<strong>${escapeHtml(destinationLabel(entry, role === 'donor'))}</strong><br>`
              + `${escapeHtml(destinationAddress(entry))}<br>`
              + `${role === 'donor' ? 'Best destination' : 'Receiver destination'}`
            )
            .on('click', () => onSelectRoute(key));

          destinationMarker.addTo(mapInstance.current);
          layersRef.current.push(destinationMarker);
          allBounds.push([destination.lat, destination.lng]);
        }
      }
    });

    mapInstance.current.invalidateSize();

    const activeBounds = activeLayer?.getBounds();
    if (activeBounds?.isValid()) {
      mapInstance.current.fitBounds(activeBounds, { padding: [34, 34], maxZoom: 14 });
    } else if (allBounds.length > 0) {
      mapInstance.current.fitBounds(allBounds, { padding: [34, 34], maxZoom: 13 });
    } else {
      mapInstance.current.setView(DEFAULT_MAP_CENTER, 11);
    }
  }, [activeRouteKey, onSelectRoute, role, routes]);

  return (
    <div className="live-map-shell">
      <div className="ops-map live-ops-map" ref={mapRef} />
      {routes.length === 0 && (
        <div className="live-map-empty">
          <strong>No route options mapped yet.</strong>
          <span>Refresh after adding listings, demand centers, or a receiver profile address.</span>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, detail }) => (
  <div className="metric-card">
    <span>{label}</span>
    <strong>{value}</strong>
    {detail && <small>{detail}</small>}
  </div>
);

const LiveSensorPanel = ({ status, loading, error, onRefresh }) => {
  const freshness = status?.freshness;
  const flags = status?.flags || {};
  const prediction = status?.prediction;
  const hours = status?.hoursUntilRotten;
  const shelfLifeText = typeof hours === 'number' ? formatShelfLife(Math.round(hours * 60)) : '--';

  const states = [
    ['Empty box', flags.emptyBox],
    ['Fresh food', flags.freshFood],
    ['Still edible', flags.stillEdible],
    ['Rotten', flags.rotten]
  ];

  return (
    <section className="ops-card live-sensor-card">
      <div className="section-header">
        <div>
          <p className="eyebrow">Live food sensor</p>
          <h2>Container condition</h2>
        </div>
        <button className="btn-secondary" type="button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Reading...' : 'Refresh'}
        </button>
      </div>

      {error && <div className="notice error-notice">{error}</div>}

      <div className="sensor-reading-grid">
        <span>
          <strong>{status?.reading?.temperatureC ?? '--'} C</strong>
          <small>Temperature</small>
        </span>
        <span>
          <strong>{status?.reading?.humidityPct ?? '--'}%</strong>
          <small>Humidity</small>
        </span>
        <span>
          <strong>{shelfLifeText}</strong>
          <small>Time until rot</small>
        </span>
        <span>
          <strong>{prediction?.label || freshnessLabel(freshness?.state)}</strong>
          <small>Matched sample</small>
        </span>
      </div>

      <div className="sensor-state-grid">
        {states.map(([label, active]) => (
          <span key={label} className={`sensor-state-pill ${active ? 'active' : ''}`}>
            {label}
          </span>
        ))}
      </div>

      <div className="sensor-summary-line">
        <span className={`status-pill ${freshnessClass(freshness?.state)}`}>
          {freshnessLabel(freshness?.state)}
        </span>
        <small>
          {status?.observedAt ? `Last reading ${formatDateTime(status.observedAt)}` : 'Waiting for live reading'}
        </small>
      </div>
    </section>
  );
};

const OperationRouteCard = ({ entry, isActive, isDonor, onSelect, onClaim }) => {
  const destination = destinationLabel(entry, isDonor);
  const risk = routeRisk(entry);
  const score = entry.allocation?.score ?? 0;
  const distanceKm = routeDistanceKm(entry);

  return (
    <article
      className={`queue-row live-route-row ${isActive ? 'active-live-route' : ''}`}
      onClick={onSelect}
    >
      <div className="live-route-main">
        <p className="eyebrow">{entry.foodItem?.category || 'general'}</p>
        <h3>{entry.foodItem?.title || 'Food route'}</h3>
        <p>{entry.foodItem?.pickupAddress || entry.foodItem?.location}</p>
        <small>
          {isDonor ? `To ${destination}` : `To ${destinationAddress(entry) || 'your saved address'}`}
        </small>
      </div>
      <div className="queue-meta live-route-meta">
        <span className={`status-pill ${routeRiskClass(risk)}`}>{risk}</span>
        <span className={`status-pill ${freshnessClass(entry.allocation?.freshness?.state || entry.foodItem?.freshness?.state)}`}>
          {freshnessLabel(entry.allocation?.freshness?.state || entry.foodItem?.freshness?.state)}
        </span>
        <strong>{score}</strong>
        <small>{formatDistance(distanceKm)}</small>
        <small>{formatDuration(entry.route?.durationSeconds)}</small>
        <small>{entry.route?.fallback ? 'Fallback route' : entry.route?.provider || 'Road route'}</small>
      </div>
      <p className="live-route-reason">{entry.allocation?.reason || 'Ranked with current freshness, expiry, and routing data.'}</p>
      <div className="live-route-actions">
        <button className="btn-secondary" type="button" onClick={(event) => { event.stopPropagation(); onSelect(); }}>
          Map route
        </button>
        {!isDonor && (
          <button className="btn-primary" type="button" onClick={(event) => { event.stopPropagation(); onClaim(entry); }}>
            Check route
          </button>
        )}
      </div>
    </article>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getStoredUser());
  const [myListings, setMyListings] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [availableFood, setAvailableFood] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [showProfileModal, setShowProfileModal] = useState(() => {
    const storedUser = getStoredUser();
    return Boolean(storedUser && !storedUser.address);
  });
  const [showFoodModal, setShowFoodModal] = useState(false);
  const [profileData, setProfileData] = useState(() => profileFromUser(getStoredUser()));
  const [foodData, setFoodData] = useState(initialFoodData);
  const [pickupPreview, setPickupPreview] = useState(null);
  const [previewStatus, setPreviewStatus] = useState('');
  const [error, setError] = useState('');
  const [routeOptions, setRouteOptions] = useState([]);
  const [routeStatus, setRouteStatus] = useState('Live map ready.');
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [lastRouteRefresh, setLastRouteRefresh] = useState(null);
  const [activeRouteKey, setActiveRouteKey] = useState('');
  const [liveSensorStatus, setLiveSensorStatus] = useState(null);
  const [liveSensorError, setLiveSensorError] = useState('');
  const [loadingLiveSensor, setLoadingLiveSensor] = useState(false);

  const isDonor = user?.role === 'donor';
  const operationalItems = isDonor ? myListings : availableFood;
  const activityItems = isDonor ? myListings : myOrders;
  const activeListings = myListings.filter((item) => item.status === 'available' || item.isAvailable);
  const claimedListings = myListings.filter((item) => item.status === 'claimed' || item.claimedBy);
  const urgentItems = operationalItems.filter((item) => ['critical', 'urgent', 'soon'].includes(item.expiry?.urgency));

  const claimedRouteOptions = useMemo(
    () => (isDonor ? myListings.map(claimedRouteFromItem).filter(Boolean) : []),
    [isDonor, myListings]
  );

  const liveRoutes = useMemo(
    () => (isDonor ? [...routeOptions, ...claimedRouteOptions] : routeOptions),
    [claimedRouteOptions, isDonor, routeOptions]
  );

  const activeRoute = useMemo(
    () => liveRoutes.find((entry) => routeKey(entry) === activeRouteKey) || liveRoutes[0] || null,
    [activeRouteKey, liveRoutes]
  );

  const selectRoute = useCallback((key) => {
    setActiveRouteKey(key);
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!user) {
      navigate('/login');
      return;
    }

    setError('');

    try {
      if (user.role === 'donor') {
        const res = await api.get(`/food/user/${user._id}`);
        setMyListings(res.data);
      } else {
        const [ordersRes, foodRes] = await Promise.all([
          api.get(`/food/orders/${user._id}`),
          api.get('/food', { params: { sort: 'bestmatch' } })
        ]);
        setMyOrders(ordersRes.data);
        setAvailableFood(foodRes.data);
      }
    } catch (err) {
      console.error('Dashboard load failed:', err);
      setError('Could not load dashboard data. Check that the backend is running.');
    }
  }, [navigate, user]);

  const loadLiveSensorStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingLiveSensor(true);
    setLiveSensorError('');

    try {
      const res = await api.get('/iot/live-status');
      setLiveSensorStatus(res.data);
    } catch (err) {
      console.error('Live sensor status failed:', err);
      setLiveSensorError(err.response?.data?.message || 'Could not load live sensor status.');
    } finally {
      setLoadingLiveSensor(false);
    }
  }, []);

  const loadOperationsRoutes = useCallback(async ({ silent = false } = {}) => {
    if (!user) return;

    if (!isDonor && !user.address) {
      setRouteOptions([]);
      setActiveRouteKey('');
      setRouteStatus('Add a receiver address in your profile to calculate live pickup routes.');
      return;
    }

    if (!silent) {
      setLoadingRoutes(true);
      setRouteStatus('Refreshing live route options...');
    }

    try {
      const res = isDonor
        ? await api.get('/demand-centers/allocations', { params: { donorId: user._id, limit: 25 } })
        : await api.get(`/food/receiver-options/${user._id}`, { params: { limit: 25, radiusKm: 25 } });
      const nextRoutes = Array.isArray(res.data)
        ? res.data.map((entry) => ({ ...entry, kind: isDonor ? 'donor' : 'receiver' }))
        : [];

      setRouteOptions(nextRoutes);
      setLastRouteRefresh(new Date());
      setRouteStatus(nextRoutes.length
        ? `${nextRoutes.length} live route option${nextRoutes.length === 1 ? '' : 's'} calculated.`
        : 'No feasible live routes right now.');
      setActiveRouteKey((currentKey) => (
        nextRoutes.some((entry) => routeKey(entry) === currentKey)
          ? currentKey
          : nextRoutes[0]
            ? routeKey(nextRoutes[0])
            : ''
      ));
    } catch (err) {
      console.error('Operations routes failed:', err);
      setRouteOptions([]);
      setActiveRouteKey('');
      setRouteStatus(err.response?.data?.message || 'Could not refresh live route options.');
    } finally {
      setLoadingRoutes(false);
    }
  }, [isDonor, user]);

  useEffect(() => {
    loadDashboard();
    loadLiveSensorStatus();
  }, [loadDashboard, loadLiveSensorStatus]);

  useEffect(() => {
    if (!user) return undefined;

    const refreshTimer = window.setInterval(() => {
      loadLiveSensorStatus({ silent: true });
    }, OPERATIONS_REFRESH_MS);

    return () => window.clearInterval(refreshTimer);
  }, [loadLiveSensorStatus, user]);

  useEffect(() => {
    if (activeTab !== 'operations' || !user) return undefined;

    loadDashboard();
    loadOperationsRoutes();

    const refreshTimer = window.setInterval(() => {
      loadDashboard();
      loadOperationsRoutes({ silent: true });
    }, OPERATIONS_REFRESH_MS);

    return () => window.clearInterval(refreshTimer);
  }, [activeTab, loadDashboard, loadOperationsRoutes, user]);

  useEffect(() => {
    if (liveRoutes.length === 0) {
      setActiveRouteKey('');
      return;
    }

    setActiveRouteKey((currentKey) => (
      liveRoutes.some((entry) => routeKey(entry) === currentKey) ? currentKey : routeKey(liveRoutes[0])
    ));
  }, [liveRoutes]);

  const updateFoodData = (field, value) => {
    setFoodData((current) => ({ ...current, [field]: value }));
  };

  const handleClaimClick = (item) => {
    navigate('/order', { state: { item, receiverLocation: profileData.address } });
  };

  const handleRouteClaim = (entry) => {
    navigate('/order', {
      state: {
        item: foodForClaim(entry),
        receiverLocation: user.address
      }
    });
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    const res = await api.put(`/auth/update/${user._id}`, profileData);
    localStorage.setItem('user', JSON.stringify(res.data));
    setUser(res.data);
    setShowProfileModal(false);
    setRouteOptions([]);
    setActiveRouteKey('');
  };

  const handlePreviewPickup = async () => {
    if (!foodData.location.trim()) {
      setPickupPreview(null);
      setPreviewStatus('Enter a pickup address first.');
      return;
    }

    setPreviewStatus('Resolving pickup address...');

    try {
      const data = await geocodeLocation(foodData.location);
      setPickupPreview(data);
      setPreviewStatus(data.displayName || 'Pickup location resolved.');
    } catch (err) {
      console.error('Pickup preview failed:', err);
      setPickupPreview(null);
      setPreviewStatus('Could not resolve that pickup address.');
    }
  };

  const handleAddFood = async (e) => {
    e.preventDefault();
    const res = await api.post('/food/add', { ...foodData, donor: user._id });
    setMyListings((current) => [res.data, ...current]);
    setFoodData(initialFoodData);
    setPickupPreview(null);
    setPreviewStatus('');
    setShowFoodModal(false);
    if (activeTab === 'operations') loadOperationsRoutes();
  };

  if (!user) return null;

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-rail">
        <div className="profile-section">
          <div className="profile-pic">{user.username.charAt(0).toUpperCase()}</div>
          <h3>{user.username}</h3>
          <p className="role-badge">{isDonor ? 'Donor' : 'Receiver'}</p>
        </div>

        <nav className="dash-nav">
          <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}>
            Overview
          </button>
          <button className={activeTab === 'operations' ? 'active' : ''} onClick={() => setActiveTab('operations')}>
            Operations
          </button>
          {!isDonor && (
            <button className={activeTab === 'browse' ? 'active' : ''} onClick={() => setActiveTab('browse')}>
              Browse Food
            </button>
          )}
          <button onClick={() => setShowProfileModal(true)}>Edit Profile</button>
          <button className="logout-btn" onClick={() => { localStorage.clear(); navigate('/login'); }}>Logout</button>
        </nav>
      </aside>

      <section className="dashboard-main">
        <header className="section-header dashboard-topbar">
          <div>
            <p className="eyebrow">{isDonor ? 'Donor workspace' : 'Receiver workspace'}</p>
            <h1>{isDonor ? 'Manage surplus before it expires.' : 'Coordinate pickups that still have time.'}</h1>
          </div>
          {isDonor && (
            <button className="btn-primary" onClick={() => setShowFoodModal(true)}>
              Add listing
            </button>
          )}
        </header>

        {error && <div className="notice error-notice">{error}</div>}

        {activeTab === 'overview' && (
          <>
            <section className="metrics-grid">
              <StatCard label={isDonor ? 'Active listings' : 'Orders placed'} value={isDonor ? activeListings.length : myOrders.length} />
              <StatCard label="Estimated meals" value={totalMeals(activityItems)} />
              <StatCard label="Food volume" value={`${totalKg(activityItems).toFixed(1)} kg`} />
              <StatCard label={isDonor ? 'Claimed listings' : 'Urgent matches'} value={isDonor ? claimedListings.length : urgentItems.length} />
            </section>

            <LiveSensorPanel
              status={liveSensorStatus}
              loading={loadingLiveSensor}
              error={liveSensorError}
              onRefresh={() => loadLiveSensorStatus()}
            />

            <section className="ops-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Recent activity</p>
                  <h2>{isDonor ? 'Your listings' : 'Order history'}</h2>
                </div>
              </div>
              <div className="table-container">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Expiry</th>
                      <th>Quantity</th>
                      <th>Meals</th>
                      <th>Freshness</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityItems.map((item) => (
                      <tr key={item._id}>
                        <td>{item.title}</td>
                        <td>{formatDateTime(item.expiryDate)}</td>
                        <td>{item.quantity}</td>
                        <td>{item.estimatedMeals || 0}</td>
                        <td><span className={`status-pill ${freshnessClass(item.freshness?.state)}`}>{freshnessLabel(item.freshness?.state)}</span></td>
                        <td><span className={`status-pill ${urgencyClass(item.expiry?.urgency)}`}>{statusLabel(item)}</span></td>
                      </tr>
                    ))}
                    {activityItems.length === 0 && (
                      <tr><td colSpan="6" className="empty-cell">No activity yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === 'operations' && (
          <section className="ops-grid live-ops-grid">
            <div className="ops-card map-card live-map-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Live operations map</p>
                  <h2>{isDonor ? 'Where your food should go' : 'Best pickups to your address'}</h2>
                </div>
                <div className="live-map-actions">
                  <span className="status-pill risk-low">{formatRefreshTime(lastRouteRefresh)}</span>
                  <button className="btn-secondary" type="button" onClick={() => { loadDashboard(); loadOperationsRoutes(); }} disabled={loadingRoutes}>
                    {loadingRoutes ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {routeStatus && <div className="notice live-map-notice">{routeStatus}</div>}

              <OperationsMap
                routes={liveRoutes}
                activeRouteKey={routeKey(activeRoute)}
                role={isDonor ? 'donor' : 'receiver'}
                onSelectRoute={selectRoute}
              />
            </div>

            <div className="ops-card operations-queue live-route-panel">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Allocation queue</p>
                  <h2>{liveRoutes.length} mapped route{liveRoutes.length === 1 ? '' : 's'}</h2>
                </div>
              </div>

              {activeRoute && (
                <div className="active-route-summary">
                  <span>
                    <strong>{activeRoute.foodItem?.title}</strong>
                    <small>{isDonor ? `To ${destinationLabel(activeRoute, true)}` : 'Pickup option'}</small>
                  </span>
                  <span>
                    <strong>{activeRoute.allocation?.score ?? 0}</strong>
                    <small>Score</small>
                  </span>
                  <span>
                    <strong>{formatDuration(activeRoute.route?.durationSeconds)}</strong>
                    <small>Travel time</small>
                  </span>
                </div>
              )}

              <div className="queue-list live-route-list">
                {liveRoutes.map((entry) => (
                  <OperationRouteCard
                    key={routeKey(entry)}
                    entry={entry}
                    isActive={routeKey(entry) === routeKey(activeRoute)}
                    isDonor={isDonor}
                    onSelect={() => selectRoute(routeKey(entry))}
                    onClaim={handleRouteClaim}
                  />
                ))}
                {liveRoutes.length === 0 && (
                  <div className="empty-state compact-empty">
                    <h3>No mapped routes</h3>
                    <p>{isDonor ? 'Add available listings and active demand centers.' : 'Save a receiver address and wait for available food.'}</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'browse' && !isDonor && (
          <section className="food-results-list">
            {availableFood.map((item) => (
              <article key={item._id} className="ops-card food-result-card">
                <div>
                  <p className="eyebrow">{item.category || 'general'}</p>
                  <h3>{item.title}</h3>
                  <p>{item.pickupAddress || item.location}</p>
                  <span className={`status-pill ${urgencyClass(item.expiry?.urgency)}`}>{urgencyLabel(item.expiry?.urgency)}</span>
                  <span className={`status-pill ${freshnessClass(item.freshness?.state)}`}>{freshnessLabel(item.freshness?.state)}</span>
                </div>
                <div className="food-result-side">
                  <p><strong>Meals</strong>{item.estimatedMeals || 0}</p>
                  <p><strong>Expires</strong>{formatDateTime(item.expiryDate)}</p>
                  <p><strong>Freshness</strong>{formatFreshnessScore(item.freshness)}</p>
                  <button className="btn-primary" onClick={() => handleClaimClick(item)}>Check route</button>
                </div>
              </article>
            ))}
            {availableFood.length === 0 && <div className="empty-state">No food available right now.</div>}
          </section>
        )}
      </section>

      {showProfileModal && (
        <div className="modal-overlay">
          <div className="modal-content modal-panel">
            <div className="section-header">
              <h3>Edit profile</h3>
              <button className="icon-close" type="button" onClick={() => setShowProfileModal(false)}>Close</button>
            </div>
            <form className="add-food-form" onSubmit={handleProfileUpdate}>
              <label>Address<input value={profileData.address} onChange={(e) => setProfileData({ ...profileData, address: e.target.value })} required /></label>
              <label>Phone<input value={profileData.phone} onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })} /></label>
              <label>Organization<input value={profileData.organization} onChange={(e) => setProfileData({ ...profileData, organization: e.target.value })} /></label>
              <button type="submit" className="btn-primary">Save profile</button>
            </form>
          </div>
        </div>
      )}

      {showFoodModal && (
        <div className="modal-overlay">
          <div className="modal-content modal-panel wide-modal">
            <div className="section-header">
              <div>
                <p className="eyebrow">New surplus listing</p>
                <h3>Add food</h3>
              </div>
              <button className="icon-close" type="button" onClick={() => setShowFoodModal(false)}>Close</button>
            </div>
            <form className="add-food-form listing-form" onSubmit={handleAddFood}>
              <label>Title<input value={foodData.title} onChange={(e) => updateFoodData('title', e.target.value)} required /></label>
              <label>Quantity<input value={foodData.quantity} onChange={(e) => updateFoodData('quantity', e.target.value)} placeholder="10 kg" required /></label>
              <label>
                Category
                <select value={foodData.category} onChange={(e) => updateFoodData('category', e.target.value)}>
                  {CATEGORY_OPTIONS.filter((option) => option.value).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>Expiry<input type="datetime-local" value={foodData.expiryDate} onChange={(e) => updateFoodData('expiryDate', e.target.value)} required /></label>
              <label>Device ID<input value={foodData.deviceId} onChange={(e) => updateFoodData('deviceId', e.target.value)} placeholder="eco-device-001" /></label>
              <label className="full-row">Pickup address<input value={foodData.location} onChange={(e) => updateFoodData('location', e.target.value)} required /></label>
              <label>Temperature C<input type="number" step="0.1" value={foodData.temperatureC} onChange={(e) => updateFoodData('temperatureC', e.target.value)} placeholder="4" /></label>
              <label>Humidity %<input type="number" step="0.1" value={foodData.humidityPct} onChange={(e) => updateFoodData('humidityPct', e.target.value)} placeholder="60" /></label>
              <label>Gas level<input type="number" step="1" value={foodData.gasLevel} onChange={(e) => updateFoodData('gasLevel', e.target.value)} placeholder="25" /></label>
              <label className="full-row">Description<textarea value={foodData.description} onChange={(e) => updateFoodData('description', e.target.value)} rows="3" /></label>
              <div className="full-row modal-actions">
                <button className="btn-secondary" type="button" onClick={handlePreviewPickup}>Preview pickup</button>
                <button className="btn-primary" type="submit">Post listing</button>
              </div>
              {(previewStatus || pickupPreview) && (
                <div className="notice full-row">
                  <strong>Pickup preview</strong>
                  <p>{previewStatus}</p>
                  {pickupPreview && (
                    <small>
                      {pickupPreview.coordinates.lat.toFixed(4)}, {pickupPreview.coordinates.lng.toFixed(4)}
                    </small>
                  )}
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default Dashboard;
