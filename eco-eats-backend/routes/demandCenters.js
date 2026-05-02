const router = require('express').Router();
const DemandCenter = require('../models/DemandCenter');
const FoodItem = require('../models/FoodItem');
const {
    calculateDistanceMeters,
    geocodeAddress,
    normalizeCoordinates,
    routeBetween
} = require('../services/locationService');
const {
    buildRouteFeasibility,
    scoreFoodItem
} = require('../services/allocationService');
const {
    buildAvailableFoodFilter,
    buildFoodDemandAllocations
} = require('../services/allocationQueueService');

function parseBoolean(value, defaultValue) {
    if (value === undefined) return defaultValue;
    return value === true || value === 'true';
}

function centerCoordinates(center) {
    return normalizeCoordinates(center.coordinates);
}

function acceptsFoodCategory(center, category) {
    const accepted = center.acceptedCategories || [];
    return accepted.length === 0 || accepted.includes(category) || accepted.includes('general');
}

function buildDemandCenterResponse(center) {
    const plain = center.toObject ? center.toObject() : { ...center };
    return {
        ...plain,
        coordinates: centerCoordinates(plain)
    };
}

router.get('/', async (req, res) => {
    try {
        const activeOnly = parseBoolean(req.query.activeOnly, true);
        const filter = activeOnly ? { active: true } : {};
        const centers = await DemandCenter.find(filter).limit(100);
        const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const results = centers
            .map((center) => buildDemandCenterResponse(center))
            .sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

        return res.status(200).json(results);
    } catch (err) {
        return res.status(500).json({ message: 'Failed to load demand centers.', error: err.message });
    }
});

router.get('/allocations', async (req, res) => {
    try {
        const now = new Date();
        const limit = Number.parseInt(req.query.limit || '25', 10);
        const foodItems = await FoodItem.find(buildAvailableFoodFilter(now, {
            donorId: req.query.donorId
        }))
            .populate('donor', 'username organization address phone')
            .limit(100);
        const demandCenters = await DemandCenter.find({ active: true }).limit(100);
        const allocations = await buildFoodDemandAllocations(foodItems, demandCenters, {
            now,
            limit: Number.isFinite(limit) ? limit : 25
        });

        return res.status(200).json(allocations);
    } catch (err) {
        return res.status(500).json({ message: 'Failed to build dispatch allocation queue.', error: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const address = req.body.address;
        let coordinates = normalizeCoordinates(req.body.coordinates || req.body);
        let geocodeProvider;

        if (!coordinates && address) {
            try {
                const geocoded = await geocodeAddress(address);
                coordinates = geocoded?.coordinates || null;
                geocodeProvider = geocoded?.provider;
            } catch (err) {
                geocodeProvider = `failed:${err.message}`;
            }
        }

        const center = new DemandCenter({
            name: req.body.name,
            address,
            coordinates: coordinates || undefined,
            geocodeProvider,
            geocodedAt: coordinates ? new Date() : undefined,
            mealNeed: Number(req.body.mealNeed || 0),
            capacityMeals: Number(req.body.capacityMeals || 0),
            urgency: req.body.urgency || 'medium',
            acceptedCategories: Array.isArray(req.body.acceptedCategories) ? req.body.acceptedCategories : [],
            operatingHours: req.body.operatingHours || '',
            contactPhone: req.body.contactPhone || '',
            notes: req.body.notes || '',
            active: req.body.active !== false
        });

        const saved = await center.save();
        return res.status(201).json(buildDemandCenterResponse(saved));
    } catch (err) {
        return res.status(500).json({ message: 'Failed to create demand center.', error: err.message });
    }
});

router.get('/matches/:foodItemId', async (req, res) => {
    try {
        const foodItem = await FoodItem.findById(req.params.foodItemId);
        if (!foodItem) {
            return res.status(404).json({ message: 'Food item not found.' });
        }

        const pickup = normalizeCoordinates(foodItem.pickupCoordinates);
        if (!pickup) {
            return res.status(400).json({ message: 'Food item needs pickup coordinates before matching.' });
        }

        const centers = await DemandCenter.find({ active: true });
        const food = foodItem.toObject();
        const matches = await Promise.all(centers
            .filter((center) => acceptsFoodCategory(center, food.category))
            .map(async (center) => {
                const dropoff = centerCoordinates(center);
                if (!dropoff) return null;

                const route = await routeBetween(pickup, dropoff);
                const distanceKm = route.distanceMeters
                    ? route.distanceMeters / 1000
                    : calculateDistanceMeters(pickup, dropoff) / 1000;
                const allocation = scoreFoodItem(food, {
                    distanceKm,
                    routeDurationSeconds: route.durationSeconds,
                    demandCenter: center.toObject()
                });
                const expiry = buildRouteFeasibility(allocation.effectiveExpiryDate || food.expiryDate, route.durationSeconds);

                return {
                    demandCenter: buildDemandCenterResponse(center),
                    route: {
                        provider: route.provider,
                        fallback: route.fallback,
                        distanceMeters: route.distanceMeters,
                        durationSeconds: route.durationSeconds,
                        geometry: route.geometry
                    },
                    expiry,
                    allocation
                };
            }));

        const limit = Number.parseInt(req.query.limit || '10', 10);
        const ranked = matches
            .filter(Boolean)
            .filter((match) => match.allocation.score >= 0)
            .sort((a, b) => (b.allocation.score || 0) - (a.allocation.score || 0))
            .slice(0, Number.isFinite(limit) ? limit : 10);

        return res.status(200).json(ranked);
    } catch (err) {
        return res.status(500).json({ message: 'Failed to rank demand center matches.', error: err.message });
    }
});

module.exports = router;
