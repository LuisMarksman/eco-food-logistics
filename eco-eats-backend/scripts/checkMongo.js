require('dotenv').config({ path: './.env' });

const mongoose = require('mongoose');

async function main() {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is missing. Paste your MongoDB Atlas connection string into eco-eats-backend/.env.');
    }

    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000)
    });

    const admin = mongoose.connection.db.admin();
    const ping = await admin.ping();

    console.log('MongoDB connection OK:', JSON.stringify(ping));
    console.log('Database:', mongoose.connection.name);

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('MongoDB connection failed:', err.message);
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
    process.exit(1);
});
