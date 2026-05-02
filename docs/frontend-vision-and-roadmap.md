# Zero Hunger Frontend Vision And Product Roadmap

## Frontend Outline

The next frontend should feel like an operations tool for rescuing perishable food, not a generic listing site. The first screen after login should show the most urgent useful action for the user's role.

### Receiver View

- Search-first food discovery with filters for location, expiry window, category, distance, and meal count.
- Food cards should show expiry urgency, estimated meals, pickup distance, donor organization, and a route feasibility badge.
- Sorting should default to "best match", using backend allocation score instead of only newest listings.
- Claim flow should require route analysis before confirmation and clearly show whether the delivery can beat expiry.

### Donor View

- Fast listing flow with title, quantity, category, pickup address, expiry date/time, and food safety notes.
- Address entry should preview a map pin once geocoded by the backend.
- Donor dashboard should separate active, claimed, expired, and cancelled listings.
- Impact stats should show estimated meals, kg saved, and claimed percentage.

### Route Analyser

- Use the backend route API as the single source of truth for coordinates, road route, duration, fallback status, and expiry feasibility.
- Show route color by risk: green for safe, amber for tight, red for misses expiry.
- Allow testing either free-text pickup/dropoff or an existing food item against a receiver location.

### Operations Dashboard

- Map + table layout showing surplus food, demand centers, urgent pickups, claimed items, and expired risk.
- Filters for status, urgency, donor, receiver, and route feasibility.
- Admin view can manually override matches when local context matters more than the automatic score.

## Product Expansion Ideas

- Demand center profiles with meal capacity, operating hours, address, dietary constraints, and urgency level.
- Multi-stop volunteer or driver routes for batching nearby pickups and dropoffs.
- Expiry alerts for donors, receivers, and coordinators.
- Food safety checklist before listing and before claiming.
- Impact dashboard: meals delivered, kg saved, CO2 avoided, water saved, and waste prevented.
- Predictive surplus suggestions for recurring donors based on past listing patterns.
- Admin matching console to review, approve, or override automatic allocations.

## Suggested Next UI Milestones

- Replace hardcoded inline styles with reusable layout, form, card, badge, and map components.
- Add a responsive app shell with role-aware navigation.
- Move all API calls into a small frontend service layer.
- Add loading, empty, and error states for every network-backed view.
- Add map previews on list, order, and dashboard pages once the backend has enough geocoded listings.
