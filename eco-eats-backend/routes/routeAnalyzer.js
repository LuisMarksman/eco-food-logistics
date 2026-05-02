const router = require('express').Router();
const FoodItem = require('../models/FoodItem');
const {
    normalizeCoordinates,
    resolvePoint,
    routeBetween
} = require('../services/locationService');
const {
    buildRouteFeasibility,
    estimateMealsFromQuantity,
    resolveFreshnessInfo,
    scoreFoodItem
} = require('../services/allocationService');

function pointFromFoodItem(foodItem) {
    const coordinates = normalizeCoordinates(foodItem.pickupCoordinates);

    if (coordinates) {
        return {
            address: foodItem.pickupAddress || foodItem.location,
            coordinates
        };
    }

    return foodItem.pickupAddress || foodItem.location;
}

router.post('/analyze', async (req, res) => {
    try {
        const { foodItemId } = req.body;
        let foodItem = null;
        let pickupInput = req.body.pickup;

        if (foodItemId) {
            foodItem = await FoodItem.findById(foodItemId);
            if (!foodItem) {
                return res.status(404).json({ message: 'Food item not found.' });
            }
            pickupInput = pointFromFoodItem(foodItem);
        }

        const pickup = await resolvePoint(pickupInput, 'pickup');
        const dropoff = await resolvePoint(req.body.dropoff, 'dropoff');
        const route = await routeBetween(pickup.coordinates, dropoff.coordinates);
        const freshness = foodItem ? resolveFreshnessInfo(foodItem.toObject()) : null;
        const expirySource = freshness?.effectiveExpiryDate || foodItem?.expiryDate || req.body.expiryDate;
        const expiry = buildRouteFeasibility(expirySource, route.durationSeconds);
        const allocation = foodItem ? scoreFoodItem(foodItem.toObject(), {
            routeDurationSeconds: route.durationSeconds
        }) : null;

        return res.status(200).json({
            pickup,
            dropoff,
            route,
            expiry,
            allocation,
            freshness,
            effectiveExpiryDate: expirySource,
            estimatedMeals: foodItem ? (foodItem.estimatedMeals || estimateMealsFromQuantity(foodItem.quantity)) : null
        });
    } catch (err) {
        return res.status(400).json({
            message: 'Could not analyze route.',
            error: err.message
        });
    }
});

router.post('/geocode', async (req, res) => {
    try {
        const point = await resolvePoint(req.body.location || req.body.address || req.body, 'location');
        return res.status(200).json(point);
    } catch (err) {
        return res.status(400).json({
            message: 'Could not geocode location.',
            error: err.message
        });
    }
});

module.exports = router;
