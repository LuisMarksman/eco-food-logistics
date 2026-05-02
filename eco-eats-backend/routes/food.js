const router = require('express').Router();
const FoodItem = require('../models/FoodItem');
const User = require('../models/User');
const {
    calculateDistanceMeters,
    geocodeAddress,
    normalizeCoordinates,
    routeBetween
} = require('../services/locationService');
const {
    estimateMealsFromQuantity,
    getExpiryInfo,
    resolveFreshnessInfo,
    scoreFoodItem
} = require('../services/allocationService');
const {
    buildAvailableFoodFilter,
    buildReceiverFoodOptions
} = require('../services/allocationQueueService');
const {
    buildFreshnessSnapshot,
    normalizeSensorReading
} = require('../services/freshnessService');

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseBoolean(value, defaultValue) {
    if (value === undefined) return defaultValue;
    return value === true || value === 'true';
}

function parsePositiveNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function itemCoordinates(item) {
    return normalizeCoordinates(item.pickupCoordinates);
}

function hasSensorPayload(payload = {}) {
    return ['temperatureC', 'temperature', 'humidityPct', 'humidity', 'gasLevel', 'gas']
        .some((field) => payload[field] !== undefined && payload[field] !== null && payload[field] !== '');
}

function buildFoodResponse(item, context = {}) {
    const plain = item.toObject ? item.toObject() : { ...item };
    const coords = itemCoordinates(plain);
    const receiverCoords = normalizeCoordinates(context);
    let distanceKm = null;

    if (coords && receiverCoords) {
        distanceKm = calculateDistanceMeters(receiverCoords, coords) / 1000;
    }

    const allocation = scoreFoodItem(plain, {
        distanceKm,
        category: context.category
    });
    const freshness = allocation.freshness || resolveFreshnessInfo(plain);

    return {
        ...plain,
        pickupAddress: plain.pickupAddress || plain.location,
        estimatedMeals: plain.estimatedMeals || allocation.estimatedMeals || estimateMealsFromQuantity(plain.quantity),
        expiry: allocation.expiry || getExpiryInfo(plain.expiryDate),
        freshness,
        effectiveExpiryDate: allocation.effectiveExpiryDate || freshness.effectiveExpiryDate || plain.expiryDate,
        allocationScore: allocation.score,
        allocationRisk: allocation.risk,
        distanceKm: typeof distanceKm === 'number' ? Number(distanceKm.toFixed(2)) : null
    };
}

function sanitizePoint(point = {}) {
    const coordinates = normalizeCoordinates(point.coordinates || point);

    if (!coordinates) return undefined;

    return {
        address: point.address || point.label || point.displayName,
        displayName: point.displayName || point.address || point.label,
        coordinates
    };
}

async function resolveReceiverPoint(receiver) {
    const cachedCoordinates = normalizeCoordinates(receiver.coordinates);

    if (cachedCoordinates) {
        return {
            address: receiver.address,
            displayName: receiver.address,
            coordinates: cachedCoordinates,
            provider: receiver.geocodeProvider || 'cached'
        };
    }

    if (!receiver.address) {
        throw new Error('Receiver profile needs an address before route options can be calculated.');
    }

    const geocoded = await geocodeAddress(receiver.address);

    if (!geocoded?.coordinates) {
        throw new Error('Could not geocode receiver address.');
    }

    await User.findByIdAndUpdate(receiver._id, {
        $set: {
            coordinates: geocoded.coordinates,
            geocodeProvider: geocoded.provider,
            geocodedAt: new Date()
        }
    });

    return geocoded;
}

function sortFood(items, sortMode) {
    const mode = sortMode || 'bestmatch';

    return items.sort((a, b) => {
        if (mode === 'expiry') {
            return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
        }

        if (mode === 'distance') {
            const aDistance = typeof a.distanceKm === 'number' ? a.distanceKm : Number.POSITIVE_INFINITY;
            const bDistance = typeof b.distanceKm === 'number' ? b.distanceKm : Number.POSITIVE_INFINITY;
            return aDistance - bDistance;
        }

        if (mode === 'meals') {
            return (b.estimatedMeals || 0) - (a.estimatedMeals || 0);
        }

        return (b.allocationScore || 0) - (a.allocationScore || 0);
    });
}

function sanitizeRouteSummary(routeSummary = {}) {
    return {
        provider: routeSummary.provider,
        fallback: Boolean(routeSummary.fallback),
        distanceMeters: routeSummary.distanceMeters,
        durationSeconds: routeSummary.durationSeconds,
        expiryRisk: routeSummary.expiry?.riskLevel || routeSummary.expiryRisk,
        freshnessRisk: routeSummary.freshness?.state || routeSummary.freshnessRisk,
        freshnessScore: routeSummary.freshness?.score ?? routeSummary.freshnessScore,
        effectiveExpiryDate: routeSummary.expiry?.effectiveExpiryDate || routeSummary.effectiveExpiryDate,
        analyzedAt: new Date(),
        pickup: sanitizePoint(routeSummary.pickup),
        dropoff: sanitizePoint(routeSummary.dropoff),
        geometry: routeSummary.geometry
    };
}

// Claim food atomically so two receivers cannot reserve the same item.
router.put('/claim/:id', async (req, res) => {
    try {
        const { receiverId, routeSummary } = req.body;

        if (!receiverId) {
            return res.status(400).json({ message: 'receiverId is required.' });
        }

        const receiver = await User.findById(receiverId);
        if (!receiver) {
            return res.status(404).json({ message: 'Receiver not found.' });
        }

        if (receiver.role !== 'receiver') {
            return res.status(403).json({ message: 'Only receivers can claim food.' });
        }

        const now = new Date();
        const updatedFood = await FoodItem.findOneAndUpdate(
            {
                _id: req.params.id,
                expiryDate: { $gt: now },
                $and: [
                    { $or: [{ isAvailable: true }, { isAvailable: { $exists: false } }] },
                    { $or: [{ status: 'available' }, { status: { $exists: false } }] },
                    { $or: [{ claimedBy: null }, { claimedBy: { $exists: false } }] },
                    { $or: [{ 'freshness.state': { $ne: 'unsafe' } }, { 'freshness.state': { $exists: false } }] },
                    {
                        $or: [
                            { 'freshness.effectiveExpiryDate': { $gt: now } },
                            { 'freshness.effectiveExpiryDate': null },
                            { 'freshness.effectiveExpiryDate': { $exists: false } }
                        ]
                    }
                ]
            },
            {
                $set: {
                    isAvailable: false,
                    status: 'claimed',
                    claimedBy: receiverId,
                    routeSummary: sanitizeRouteSummary(routeSummary)
                }
            },
            { new: true }
        );

        if (!updatedFood) {
            return res.status(409).json({ message: 'This food item is no longer available or has expired.' });
        }

        return res.status(200).json(buildFoodResponse(updatedFood));
    } catch (err) {
        return res.status(500).json({ message: 'Failed to claim food.', error: err.message });
    }
});

// Get orders claimed by a receiver.
router.get('/orders/:userId', async (req, res) => {
    try {
        const orders = await FoodItem.find({ claimedBy: req.params.userId }).sort({ updatedAt: -1 });
        return res.status(200).json(orders.map((item) => buildFoodResponse(item)));
    } catch (err) {
        return res.status(500).json({ message: 'Failed to load orders.', error: err.message });
    }
});

// Rank currently available food against a receiver's saved destination.
router.get('/receiver-options/:receiverId', async (req, res) => {
    try {
        const receiver = await User.findById(req.params.receiverId);

        if (!receiver) {
            return res.status(404).json({ message: 'Receiver not found.' });
        }

        if (receiver.role !== 'receiver') {
            return res.status(403).json({ message: 'Only receiver profiles can request receiver route options.' });
        }

        const now = new Date();
        const limit = Number.parseInt(req.query.limit || '25', 10);
        const radiusKm = parsePositiveNumber(req.query.radiusKm) || 25;
        const receiverPoint = await resolveReceiverPoint(receiver);
        const foodItems = await FoodItem.find(buildAvailableFoodFilter(now))
            .populate('donor', 'username organization address phone')
            .limit(100);
        const options = await buildReceiverFoodOptions(foodItems, receiverPoint, {
            now,
            limit: Number.isFinite(limit) ? limit : 25,
            radiusKm,
            routeBetweenFn: routeBetween
        });

        return res.status(200).json(options);
    } catch (err) {
        return res.status(500).json({ message: 'Failed to build receiver route options.', error: err.message });
    }
});

// Add new food item. Donors only.
router.post('/add', async (req, res) => {
    try {
        const user = await User.findById(req.body.donor);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (user.role !== 'donor') {
            return res.status(403).json({ message: 'Only donors can post food.' });
        }

        const expiryDate = new Date(req.body.expiryDate);
        if (Number.isNaN(expiryDate.getTime())) {
            return res.status(400).json({ message: 'A valid expiryDate is required.' });
        }

        if (expiryDate <= new Date()) {
            return res.status(400).json({ message: 'Food must expire in the future.' });
        }

        const pickupAddress = req.body.pickupAddress || req.body.location;
        let coordinates = normalizeCoordinates(req.body.pickupCoordinates || req.body.coordinates || req.body);
        let geocodeProvider;

        if (!coordinates && pickupAddress) {
            try {
                const geocoded = await geocodeAddress(pickupAddress);
                coordinates = geocoded?.coordinates || null;
                geocodeProvider = geocoded?.provider;
            } catch (err) {
                geocodeProvider = `failed:${err.message}`;
            }
        }

        const category = req.body.category || 'general';
        const sensorPayload = req.body.sensorReading || req.body.freshness || req.body;
        const initialReading = hasSensorPayload(sensorPayload)
            ? normalizeSensorReading(sensorPayload)
            : null;
        const freshness = buildFreshnessSnapshot(initialReading || {}, {
            expiryDate,
            category
        });

        const newFood = new FoodItem({
            title: req.body.title,
            description: req.body.description,
            location: pickupAddress,
            pickupAddress,
            pickupCoordinates: coordinates || undefined,
            geocodeProvider,
            geocodedAt: coordinates ? new Date() : undefined,
            expiryDate,
            expiryTimestamp: expiryDate,
            quantity: req.body.quantity,
            category,
            estimatedMeals: estimateMealsFromQuantity(req.body.quantity),
            deviceId: req.body.deviceId,
            sensorReadings: initialReading ? [{
                temperatureC: initialReading.temperatureC,
                humidityPct: initialReading.humidityPct,
                gasLevel: initialReading.gasLevel,
                gasIndex: initialReading.gasIndex,
                observedAt: initialReading.observedAt,
                receivedAt: new Date(),
                source: initialReading.source
            }] : [],
            freshness,
            donor: req.body.donor,
            isAvailable: true,
            status: 'available'
        });

        const savedFood = await newFood.save();
        return res.status(201).json(buildFoodResponse(savedFood));
    } catch (err) {
        return res.status(500).json({ message: 'Failed to add food.', error: err.message });
    }
});

// Search/list food. Defaults to available, non-expired items.
router.get('/', async (req, res) => {
    try {
        const now = new Date();
        const availableOnly = parseBoolean(req.query.availableOnly, true);
        const includeExpired = parseBoolean(req.query.includeExpired, false);
        const expiresWithinHours = parsePositiveNumber(req.query.expiresWithinHours);
        const filter = {};
        const andFilters = [];

        if (!includeExpired) {
            const expiryFilter = { $gt: now };
            if (expiresWithinHours) {
                expiryFilter.$lte = new Date(now.getTime() + expiresWithinHours * 60 * 60 * 1000);
            }
            filter.expiryDate = expiryFilter;
        }

        if (availableOnly) {
            andFilters.push(
                { $or: [{ isAvailable: true }, { isAvailable: { $exists: false } }] },
                { $or: [{ status: 'available' }, { status: { $exists: false } }] },
                { $or: [{ claimedBy: null }, { claimedBy: { $exists: false } }] }
            );
        }

        if (req.query.category) {
            filter.category = req.query.category;
        }

        if (req.query.q) {
            const regex = new RegExp(escapeRegex(req.query.q), 'i');
            andFilters.push({
                $or: [
                    { title: regex },
                    { description: regex },
                    { location: regex },
                    { pickupAddress: regex },
                    { category: regex }
                ]
            });
        }

        if (andFilters.length > 0) {
            filter.$and = andFilters;
        }

        const receiverCoords = normalizeCoordinates({ lat: req.query.lat, lng: req.query.lng });
        const radiusKm = parsePositiveNumber(req.query.radiusKm);
        const foodList = await FoodItem.find(filter)
            .populate('donor', 'username organization address phone')
            .limit(100);

        let results = foodList.map((item) => buildFoodResponse(item, {
            lat: receiverCoords?.lat,
            lng: receiverCoords?.lng,
            category: req.query.category
        }));

        if (!includeExpired) {
            results = results.filter((item) => item.expiry?.expired !== true && item.allocationScore >= 0);
        }

        if (receiverCoords && radiusKm) {
            results = results.filter((item) => typeof item.distanceKm === 'number' && item.distanceKm <= radiusKm);
        }

        return res.status(200).json(sortFood(results, req.query.sort));
    } catch (err) {
        return res.status(500).json({ message: 'Failed to load food items.', error: err.message });
    }
});

router.get('/user/:userId', async (req, res) => {
    try {
        const userFood = await FoodItem.find({ donor: req.params.userId }).sort({ createdAt: -1 });
        return res.status(200).json(userFood.map((item) => buildFoodResponse(item)));
    } catch (err) {
        return res.status(500).json({ message: 'Failed to load donor food.', error: err.message });
    }
});

router._test = {
    sanitizeRouteSummary
};

module.exports = router;
