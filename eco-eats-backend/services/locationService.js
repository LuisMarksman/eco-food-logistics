const geocodeCache = new Map();
const routeCache = new Map();

const GEOCODER_BASE_URL = process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org';
const ROUTER_BASE_URL = process.env.ROUTER_BASE_URL || 'https://router.project-osrm.org';
const GEOCODER_USER_AGENT = process.env.GEOCODER_USER_AGENT || 'eco-eats-zero-hunger-mvp/1.0';

function toNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCoordinates(input) {
    if (!input) return null;

    const lat = toNumber(input.lat ?? input.latitude);
    const lng = toNumber(input.lng ?? input.lon ?? input.longitude);

    if (lat === null || lng === null) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
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

function fallbackRoute(start, end, reason = 'Routing service unavailable') {
    const distanceMeters = calculateDistanceMeters(start, end);
    const averageUrbanSpeedMetersPerSecond = 25000 / 3600;

    return {
        provider: 'fallback_haversine',
        fallback: true,
        reason,
        distanceMeters: Math.round(distanceMeters),
        durationSeconds: Math.round(distanceMeters / averageUrbanSpeedMetersPerSecond),
        geometry: {
            type: 'LineString',
            coordinates: [
                [start.lng, start.lat],
                [end.lng, end.lat]
            ]
        }
    };
}

async function geocodeAddress(address) {
    if (!address || typeof address !== 'string') return null;

    const cacheKey = address.trim().toLowerCase();
    if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

    const url = new URL('/search', GEOCODER_BASE_URL);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('q', address);

    const response = await fetch(url, {
        headers: {
            'User-Agent': GEOCODER_USER_AGENT,
            'Accept-Language': 'en'
        }
    });

    if (!response.ok) {
        throw new Error(`Geocoding failed with status ${response.status}`);
    }

    const results = await response.json();
    const first = Array.isArray(results) ? results[0] : null;

    if (!first) return null;

    const geocoded = {
        address,
        displayName: first.display_name,
        coordinates: {
            lat: Number.parseFloat(first.lat),
            lng: Number.parseFloat(first.lon)
        },
        provider: 'nominatim'
    };

    geocodeCache.set(cacheKey, geocoded);
    return geocoded;
}

async function resolvePoint(input, label = 'location') {
    if (typeof input === 'string') {
        const geocoded = await geocodeAddress(input);
        if (!geocoded) throw new Error(`Could not geocode ${label}.`);
        return geocoded;
    }

    const directCoordinates = normalizeCoordinates(input?.coordinates || input);
    if (directCoordinates) {
        return {
            address: input.address || input.label || label,
            displayName: input.address || input.label || label,
            coordinates: directCoordinates,
            provider: 'provided'
        };
    }

    if (input?.address) {
        const geocoded = await geocodeAddress(input.address);
        if (!geocoded) throw new Error(`Could not geocode ${label}.`);
        return geocoded;
    }

    throw new Error(`Missing ${label}.`);
}

async function routeBetween(start, end) {
    const startCoords = normalizeCoordinates(start);
    const endCoords = normalizeCoordinates(end);

    if (!startCoords || !endCoords) {
        throw new Error('Valid start and end coordinates are required.');
    }

    const cacheKey = `${startCoords.lat},${startCoords.lng}:${endCoords.lat},${endCoords.lng}`;
    if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);

    const url = new URL(`/route/v1/driving/${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}`, ROUTER_BASE_URL);
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Routing failed with status ${response.status}`);
        }

        const data = await response.json();
        const route = data.routes?.[0];

        if (!route) {
            throw new Error('No route returned.');
        }

        const routed = {
            provider: 'osrm',
            fallback: false,
            distanceMeters: Math.round(route.distance),
            durationSeconds: Math.round(route.duration),
            geometry: route.geometry
        };

        routeCache.set(cacheKey, routed);
        return routed;
    } catch (err) {
        const fallback = fallbackRoute(startCoords, endCoords, err.message);
        routeCache.set(cacheKey, fallback);
        return fallback;
    }
}

module.exports = {
    calculateDistanceMeters,
    fallbackRoute,
    geocodeAddress,
    normalizeCoordinates,
    resolvePoint,
    routeBetween
};
