const axios = require('axios');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Fast, no-network straight-line distance in meters. Used for dispatch
 * ranking (which dasher is closest) where "good enough" beats "exact."
 */
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Real driving ETA + turn-by-turn polyline from Google Directions API.
 * Used for: (1) customer-facing "arrives in ~18 min", (2) the dasher app's
 * turn-by-turn navigation screen.
 *
 * Falls back to a straight-line estimate (assuming ~25 km/h avg city speed)
 * if no API key is configured yet, so the rest of the system still works
 * during local dev.
 */
async function getDrivingEta(origin, destination) {
  if (!GOOGLE_MAPS_API_KEY) {
    const meters = haversineMeters(origin, destination);
    const estimatedSeconds = (meters / 1000 / 25) * 3600;
    return {
      distanceMeters: Math.round(meters),
      durationSeconds: Math.round(estimatedSeconds),
      polyline: null,
      steps: [],
      source: 'estimate', // flag so the frontend can show "approx." if needed
    };
  }

  const url = 'https://maps.googleapis.com/maps/api/directions/json';
  const { data } = await axios.get(url, {
    params: {
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'driving',
      key: GOOGLE_MAPS_API_KEY,
    },
  });

  if (data.status !== 'OK' || !data.routes.length) {
    throw new Error(`Directions API error: ${data.status}`);
  }

  const route = data.routes[0];
  const leg = route.legs[0];

  return {
    distanceMeters: leg.distance.value,
    durationSeconds: leg.duration.value,
    polyline: route.overview_polyline.points, // decode client-side for the map line
    steps: leg.steps.map((s) => ({
      instruction: s.html_instructions,
      distanceMeters: s.distance.value,
      durationSeconds: s.duration.value,
      maneuver: s.maneuver || null,
      startLocation: s.start_location,
      endLocation: s.end_location,
    })),
    source: 'google_directions',
  };
}

module.exports = { haversineMeters, getDrivingEta };
