const mongoose = require('mongoose');

const FoodItemSchema = new mongoose.Schema({
    title: { type: String, required: true },
    quantity: { type: String, required: true }, // e.g., "5 kg"
    location: { type: String, required: true },
    pickupAddress: { type: String },
    pickupCoordinates: {
        lat: { type: Number },
        lng: { type: Number }
    },
    geocodeProvider: { type: String },
    geocodedAt: { type: Date },
    expiryDate: { type: Date, required: true },
    expiryTimestamp: { type: Date },
    description: { type: String },
    category: { type: String, default: 'general', trim: true },
    estimatedMeals: { type: Number, default: 0 },
    deviceId: { type: String, trim: true, index: true },
    sensorReadings: [{
        temperatureC: { type: Number },
        humidityPct: { type: Number },
        gasLevel: { type: Number },
        gasIndex: { type: Number },
        mq2: { type: Number },
        mq3: { type: Number },
        mq135: { type: Number },
        observedAt: { type: Date },
        receivedAt: { type: Date, default: Date.now },
        source: { type: String, default: 'sensor' }
    }],
    freshness: {
        score: { type: Number },
        state: {
            type: String,
            enum: ['excellent', 'good', 'watch', 'critical', 'unsafe', 'unknown'],
            default: 'unknown'
        },
        temperatureC: { type: Number },
        humidityPct: { type: Number },
        gasLevel: { type: Number },
        gasIndex: { type: Number },
        mq2: { type: Number },
        mq3: { type: Number },
        mq135: { type: Number },
        lastSensorAt: { type: Date },
        effectiveExpiryDate: { type: Date },
        remainingShelfLifeMinutes: { type: Number },
        confidence: { type: Number, default: 0 },
        recommendation: { type: String },
        model: { type: Object },
        signals: [{ type: String }]
    },
    isAvailable: { type: Boolean, default: true },
    status: {
        type: String,
        enum: ['available', 'claimed', 'expired', 'cancelled'],
        default: 'available'
    },
    
    // Link to the Donor
    donor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // --- NEW FIELD: Link to the Receiver (Who claimed it) ---
    claimedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    routeSummary: {
        provider: { type: String },
        fallback: { type: Boolean },
        distanceMeters: { type: Number },
        durationSeconds: { type: Number },
        expiryRisk: { type: String },
        freshnessRisk: { type: String },
        freshnessScore: { type: Number },
        effectiveExpiryDate: { type: Date },
        analyzedAt: { type: Date },
        pickup: {
            address: { type: String },
            displayName: { type: String },
            coordinates: {
                lat: { type: Number },
                lng: { type: Number }
            }
        },
        dropoff: {
            address: { type: String },
            displayName: { type: String },
            coordinates: {
                lat: { type: Number },
                lng: { type: Number }
            }
        },
        geometry: { type: Object }
    }
    
}, { timestamps: true });

FoodItemSchema.index({ title: 'text', description: 'text', location: 'text', category: 'text' });
FoodItemSchema.index({ isAvailable: 1, status: 1, expiryDate: 1 });
FoodItemSchema.index({ claimedBy: 1 });
FoodItemSchema.index({ 'freshness.effectiveExpiryDate': 1, 'freshness.state': 1 });

FoodItemSchema.pre('validate', function syncLegacyLocationFields() {
    if (!this.pickupAddress && this.location) {
        this.pickupAddress = this.location;
    }

    if (!this.location && this.pickupAddress) {
        this.location = this.pickupAddress;
    }

    if (!this.expiryTimestamp && this.expiryDate) {
        this.expiryTimestamp = this.expiryDate;
    }

    if (!this.freshness) {
        this.freshness = {};
    }

    if (!this.freshness.effectiveExpiryDate && this.expiryDate) {
        this.freshness.effectiveExpiryDate = this.expiryDate;
    }

    if (!this.freshness.state) {
        this.freshness.state = 'unknown';
    }

    if (this.isAvailable === false && this.status === 'available') {
        this.status = 'claimed';
    }

});

module.exports = mongoose.model('FoodItem', FoodItemSchema);
