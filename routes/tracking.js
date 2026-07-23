const express = require('express');
const DasherLocation = require('../models/DasherLocation');
const { getDrivingEta } = require('../services/eta');

module.exports = function trackingRouter() {
  const router = express.Router();

  // Dasher app: REST fallback for location ping if socket is briefly down.
  router.post('/dasher/:dasherId/location', async (req, res) => {
    const { lat, lng, heading, speed } = req.body;
    const loc = await DasherLocation.findOneAndUpdate(
      { dasherId: req.params.dasherId },
      { lat, lng, heading, speed, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json(loc);
  });

  // Turn-by-turn navigation for the dasher app's active leg (to store or to customer).
  router.get('/eta', async (req, res) => {
    try {
      const { originLat, originLng, destLat, destLng } = req.query;
      const eta = await getDrivingEta(
        { lat: Number(originLat), lng: Number(originLng) },
        { lat: Number(destLat), lng: Number(destLng) }
      );
      res.json(eta);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
