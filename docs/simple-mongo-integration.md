# Simple Mongo Integration

The app is already built for MongoDB through Mongoose. For the hackathon, the simplest reliable
setup is MongoDB Atlas.

## One-Time Setup

1. Create a free MongoDB Atlas cluster.
2. Create a database user and password.
3. Add your current IP address to Atlas network access.
4. Copy the Node.js connection string.
5. Paste it into `eco-eats-backend/.env`:

```env
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/eco-eats?retryWrites=true&w=majority
```

Keep these local values:

```env
PORT=5000
JWT_SECRET=eco-eats-local-dev-secret-change-before-production
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174
```

## Verify Mongo

From `eco-eats-backend`:

```powershell
npm.cmd run check:db
```

Expected result:

```text
MongoDB connection OK: {"ok":1}
Database: eco-eats
```

## Seed Demo Data

From `eco-eats-backend`:

```powershell
npm.cmd run seed
```

This creates:

- donor user: `donor@ecoeats.demo` / `demo1234`
- receiver user: `receiver@ecoeats.demo` / `demo1234`
- two food listings with freshness data
- two demand centers

## Restart Backend

```powershell
node server.js
```

Then check:

```text
http://127.0.0.1:5000/api/health
```

The backend should show:

```json
{
  "mode": "full",
  "database": "connected",
  "missingEnv": []
}
```

## What Works After This

- login and registration;
- donor food listing;
- receiver search;
- route analysis;
- claim locking;
- hardware telemetry attached to food items;
- demand center creation;
- demand center route ranking;
- freshness-aware delivery deadlines.
