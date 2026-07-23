const DasherLocation = require('../models/DasherLocation');
const { haversineMeters } = require('./eta');

const MAX_DISPATCH_RADIUS_METERS = 8000; // ~5 miles, tune per market density

/**
 * Find available dashers near a store, closest first. Simple radius +
 * sort approach — good enough for launch. Swap in a proper geo query
 * (Mongo 2dsphere) once dasher counts get large enough that scanning
 * all "available" docs is slow.
 */
async function findNearbyDashers(pickupLocation, limit = 5) {
  const candidates = await DasherLocation.find({
    isOnline: true,
    isAvailable: true,
  }).lean();

  return candidates
    .map((d) => ({
      ...d,
      distanceMeters: haversineMeters(pickupLocation, d),
    }))
    .filter((d) => d.distanceMeters <= MAX_DISPATCH_RADIUS_METERS)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

module.exports = { findNearbyDashers, MAX_DISPATCH_RADIUS_METERS };
