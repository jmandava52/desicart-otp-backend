const mongoose = require('mongoose');

// One doc per dasher, upserted on every location ping. Keeping this separate
// from Order means we can find "who's nearby and free" for dispatch without
// scanning orders.
const dasherLocationSchema = new mongoose.Schema(
  {
    dasherId: { type: String, required: true, unique: true, index: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    heading: { type: Number }, // degrees, for the navigation arrow on the map
    speed: { type: Number },   // m/s, optional, from device GPS
    isOnline: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true }, // online but not on a delivery
    activeOrderId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Geospatial index lets us do "find dashers within X meters" for dispatch.
dasherLocationSchema.index({ lat: 1, lng: 1 });

module.exports = mongoose.model('DasherLocation', dasherLocationSchema);
