import { api } from '../api';

const GEOCODER_BASE_URL = 'https://nominatim.openstreetmap.org';
const ROUTER_BASE_URL = 'https://router.project-osrm.org';
const EXPIRY_BUFFER_MINUTES = 20;

function toNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeCoordinates(input) {
  if (!input) return null;

  const lat = toNumber(input.lat ?? input.latitude);
  const lng = toNumber(input.lng ?? input.lon ?? input.longitude);

  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

async function fetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept-Language': 'en' }
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function directGeocode(address) {
  if (!address || typeof address !== 'string') {
    throw new Error('A location address is required.');
  }

  const url = new URL('/search', GEOCODER_BASE_URL);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', address);

  const results = await fetchJson(url);
  const first = Array.isArray(results) ? results[0] : null;

  if (!first) {
    throw new Error(`Could not geocode ${address}.`);
  }

  return {
    address,
    displayName: first.display_name,
    coordinates: {
      lat: Number.parseFloat(first.lat),
      lng: Number.parseFloat(first.lon)
    },
    provider: 'nominatim-browser'
  };
}

async function resolvePoint(input, label) {
  const coordinates = normalizeCoordinates(input?.coordinates || input);

  if (coordinates) {
    return {
      address: input.address || input.label || label,
      displayName: input.address || input.label || label,
      coordinates,
      provider: 'provided'
    };
  }

  if (typeof input === 'string') return directGeocode(input);
  if (input?.address) return directGeocode(input.address);

  throw new Error(`Missing ${label} location.`);
}

function calculateDistanceMeters(start, end) {
  const earthRadiusMeters = 6371000;
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(end.lat - start.lat);
  const dLng = toRad(end.lng - start.lng);
  const lat1 = toRad(start.lat);
  const lat2 = toRad(end.lat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function fallbackRoute(start, end, reason) {
  const distanceMeters = calculateDistanceMeters(start, end);
  const urbanSpeedMetersPerSecond = 25000 / 3600;

  return {
    provider: 'fallback_haversine_browser',
    fallback: true,
    reason,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds: Math.round(distanceMeters / urbanSpeedMetersPerSecond),
    geometry: {
      type: 'LineString',
      coordinates: [
        [start.lng, start.lat],
        [end.lng, end.lat]
      ]
    }
  };
}

async function directRoute(start, end) {
  const url = new URL(`/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}`, ROUTER_BASE_URL);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');

  try {
    const data = await fetchJson(url);
    const route = data.routes?.[0];

    if (!route) throw new Error('No route returned.');

    return {
      provider: 'osrm-browser',
      fallback: false,
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      geometry: route.geometry
    };
  } catch (err) {
    return fallbackRoute(start, end, err.message);
  }
}

function buildExpiryFeasibility(expiryDate, durationSeconds = 0) {
  if (!expiryDate) {
    return {
      riskLevel: 'unknown',
      canDeliverBeforeExpiry: true,
      bufferMinutes: EXPIRY_BUFFER_MINUTES
    };
  }

  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) {
    return {
      riskLevel: 'unknown',
      canDeliverBeforeExpiry: true,
      bufferMinutes: EXPIRY_BUFFER_MINUTES
    };
  }

  const remainingMs = expiry.getTime() - Date.now();
  const travelMs = Number(durationSeconds || 0) * 1000;
  const bufferMs = EXPIRY_BUFFER_MINUTES * 60 * 1000;
  const canDeliverBeforeExpiry = remainingMs > travelMs + bufferMs;
  let riskLevel = 'ok';

  if (remainingMs <= 0) riskLevel = 'expired';
  else if (!canDeliverBeforeExpiry) riskLevel = 'misses_expiry';
  else if (remainingMs <= travelMs + bufferMs * 2) riskLevel = 'tight';

  return {
    riskLevel,
    canDeliverBeforeExpiry,
    bufferMinutes: EXPIRY_BUFFER_MINUTES,
    estimatedTravelMinutes: Math.round(Number(durationSeconds || 0) / 60)
  };
}

async function directAnalyzeRoute(payload, failureReason) {
  const pickup = await resolvePoint(payload.pickup, 'pickup');
  const dropoff = await resolvePoint(payload.dropoff, 'dropoff');
  const route = await directRoute(pickup.coordinates, dropoff.coordinates);

  return {
    pickup,
    dropoff,
    route: {
      ...route,
      backendFallback: true,
      backendFailureReason: failureReason
    },
    expiry: buildExpiryFeasibility(payload.expiryDate, route.durationSeconds),
    allocation: null,
    estimatedMeals: null
  };
}

export async function analyzeRoute(payload) {
  try {
    const res = await api.post('/routes/analyze', payload);
    return res.data;
  } catch (err) {
    return directAnalyzeRoute(payload, err.response?.data?.message || err.message);
  }
}

export async function geocodeLocation(location) {
  try {
    const res = await api.post('/routes/geocode', { location });
    return res.data;
  } catch {
    return directGeocode(location);
  }
}
