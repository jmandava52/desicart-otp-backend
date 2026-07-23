const { Server } = require('socket.io');
const Order = require('../models/Order');
const DasherLocation = require('../models/DasherLocation');
const { findNearbyDashers } = require('../services/dispatch');

/**
 * All three apps (customer, dasher, store) connect to this same socket
 * server. Rooms:
 *   order:<orderId>        - customer + store + assigned dasher, for that order's
 *                             status + live position updates
 *   dasher:<dasherId>      - just that dasher, for personal dispatch offers
 *   store:<storeId>        - store app, for the incoming-order queue
 *
 * Call attachSocketServer(httpServer) once from your existing server.js.
 */
function attachSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' }, // tighten to your app's origin(s) before production
  });

  io.on('connection', (socket) => {
    // --- Room membership -------------------------------------------------
    socket.on('join_order_room', (orderId) => {
      socket.join(`order:${orderId}`);
    });

    socket.on('leave_order_room', (orderId) => {
      socket.leave(`order:${orderId}`);
    });

    socket.on('dasher_online', async ({ dasherId, lat, lng }) => {
      socket.join(`dasher:${dasherId}`);
      await DasherLocation.findOneAndUpdate(
        { dasherId },
        { dasherId, lat, lng, isOnline: true, isAvailable: true, updatedAt: new Date() },
        { upsert: true }
      );
    });

    socket.on('dasher_offline', async ({ dasherId }) => {
      await DasherLocation.findOneAndUpdate(
        { dasherId },
        { isOnline: false, isAvailable: false, updatedAt: new Date() }
      );
    });

    socket.on('join_store_room', (storeId) => {
      socket.join(`store:${storeId}`);
    });

    // --- Live GPS from the dasher app ------------------------------------
    // Dasher app calls this every few seconds while navigating. We fan it
    // out to whoever's watching this order (customer + store) and persist
    // the latest fix so REST clients (app cold-start, page refresh) can
    // also get a current position without waiting for the next socket tick.
    socket.on('dasher_location_update', async ({ dasherId, orderId, lat, lng, heading, speed }) => {
      await DasherLocation.findOneAndUpdate(
        { dasherId },
        { lat, lng, heading, speed, updatedAt: new Date() },
        { upsert: true }
      );

      if (orderId) {
        await Order.findByIdAndUpdate(orderId, {
          dasherLocation: { lat, lng, updatedAt: new Date() },
        });

        io.to(`order:${orderId}`).emit('dasher_location', {
          orderId,
          dasherId,
          lat,
          lng,
          heading,
          speed,
          updatedAt: new Date(),
        });
      }
    });

    // --- Order status transitions -----------------------------------------
    // Store or dasher apps call this; we persist then broadcast to the
    // order room so every app updates instantly without polling.
    socket.on('order_status_update', async ({ orderId, status, note }) => {
      const order = await Order.findById(orderId);
      if (!order) return;

      order.transitionTo(status, note);
      await order.save();

      io.to(`order:${orderId}`).emit('order_status', {
        orderId,
        status,
        statusHistory: order.statusHistory,
        updatedAt: new Date(),
      });

      // Keep the store's live queue in sync too.
      io.to(`store:${order.storeId}`).emit('store_order_update', {
        orderId,
        status,
      });
    });

    // --- Dispatch: offer a new order to nearby dashers --------------------
    // Called from the REST route when a store marks an order ready_for_pickup.
    // Exposed on the socket layer too so it can be triggered from here in tests.
    socket.on('dispatch_order', async ({ orderId, pickupLocation }) => {
      const nearby = await findNearbyDashers(pickupLocation);
      nearby.forEach((dasher) => {
        io.to(`dasher:${dasher.dasherId}`).emit('order_offer', {
          orderId,
          pickupLocation,
          distanceMeters: Math.round(dasher.distanceMeters),
        });
      });
    });

    // --- A dasher accepts an offered order --------------------------------
    socket.on('dasher_accept_order', async ({ orderId, dasherId }) => {
      const order = await Order.findById(orderId);
      if (!order || order.dasherId) {
        // Already taken by another dasher — tell this one it's gone.
        socket.emit('order_offer_expired', { orderId });
        return;
      }

      order.dasherId = dasherId;
      order.transitionTo('dasher_assigned');
      await order.save();

      await DasherLocation.findOneAndUpdate(
        { dasherId },
        { isAvailable: false, activeOrderId: orderId }
      );

      socket.join(`order:${orderId}`);
      io.to(`order:${orderId}`).emit('order_status', {
        orderId,
        status: 'dasher_assigned',
        dasherId,
        statusHistory: order.statusHistory,
      });
    });

    socket.on('disconnect', () => {
      // Intentionally no-op: we rely on explicit dasher_offline rather than
      // treating a dropped socket as "offline," since mobile connections
      // flap constantly. A staleness check (updatedAt older than N minutes)
      // in the dispatch query is a good follow-up.
    });
  });

  return io;
}

module.exports = { attachSocketServer };
