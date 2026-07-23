const express = require('express');
const Order = require('../models/Order');
const { getDrivingEta } = require('../services/eta');
const { findNearbyDashers } = require('../services/dispatch');

module.exports = function ordersRouter(io) {
  const router = express.Router();

  // Customer app: checkout
  router.post('/', async (req, res) => {
    try {
      const { customerId, storeId, items, subtotal, deliveryFee, tip, total, pickupLocation, deliveryLocation } = req.body;
      const order = await Order.create({
        customerId, storeId, items, subtotal, deliveryFee, tip, total, pickupLocation, deliveryLocation,
      });
      io.to(`store:${storeId}`).emit('store_order_update', { orderId: order._id, status: 'placed' });
      res.status(201).json(order);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Any app: full order + live tracking snapshot. This is what the
  // customer app calls on load before the socket connection catches up.
  router.get('/:id', async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    let eta = null;
    if (order.dasherLocation?.lat && order.status !== 'delivered') {
      try {
        eta = await getDrivingEta(order.dasherLocation, order.deliveryLocation);
      } catch (e) {
        eta = null; // don't fail the whole request if Directions API hiccups
      }
    }

    res.json({ order, eta });
  });

  // Store app: mark ready, which triggers dispatch to nearby dashers
  router.patch('/:id/status', async (req, res) => {
    const { status, note } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    order.transitionTo(status, note);
    await order.save();

    io.to(`order:${order._id}`).emit('order_status', {
      orderId: order._id,
      status,
      statusHistory: order.statusHistory,
    });

    if (status === 'ready_for_pickup') {
      const nearby = await findNearbyDashers(order.pickupLocation);
      nearby.forEach((dasher) => {
        io.to(`dasher:${dasher.dasherId}`).emit('order_offer', {
          orderId: order._id,
          pickupLocation: order.pickupLocation,
          distanceMeters: Math.round(dasher.distanceMeters),
        });
      });
    }

    res.json(order);
  });

  // Store app: live queue of active orders
  router.get('/store/:storeId/active', async (req, res) => {
    const orders = await Order.find({
      storeId: req.params.storeId,
      status: { $nin: ['delivered', 'cancelled'] },
    }).sort({ createdAt: 1 });
    res.json(orders);
  });

  // Dasher app: order history / earnings source
  router.get('/dasher/:dasherId', async (req, res) => {
    const orders = await Order.find({ dasherId: req.params.dasherId }).sort({ createdAt: -1 });
    res.json(orders);
  });

  return router;
};
