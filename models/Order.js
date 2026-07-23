const mongoose = require('mongoose');

// Order lifecycle. Every status change is appended to statusHistory so the
// customer/store/dasher apps can all replay "what happened when."
const ORDER_STATUSES = [
  'placed',           // customer checked out
  'accepted',         // store confirmed they'll fulfill it
  'preparing',        // store is picking/packing items
  'ready_for_pickup',// store finished, waiting for a dasher
  'dasher_assigned',  // a dasher accepted the delivery
  'picked_up',        // dasher confirmed pickup at store
  'en_route',         // dasher is driving to customer
  'delivered',        // dasher confirmed drop-off
  'cancelled',
];

const itemSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true }, // unit price at time of order
  },
  { _id: false }
);

const geoPointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    address: { type: String },
  },
  { _id: false }
);

const statusEventSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, index: true },
    storeId: { type: String, required: true, index: true },
    dasherId: { type: String, default: null, index: true },

    items: { type: [itemSchema], required: true },
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, required: true, default: 0 },
    tip: { type: Number, default: 0 },
    total: { type: Number, required: true },

    pickupLocation: { type: geoPointSchema, required: true },   // store address
    deliveryLocation: { type: geoPointSchema, required: true }, // customer address

    status: { type: String, enum: ORDER_STATUSES, default: 'placed', index: true },
    statusHistory: { type: [statusEventSchema], default: () => [{ status: 'placed' }] },

    // Denormalized last-known dasher position for fast reads without
    // hitting the DasherLocation collection. Updated on every socket ping.
    dasherLocation: {
      lat: { type: Number },
      lng: { type: Number },
      updatedAt: { type: Date },
    },

    estimatedDeliveryAt: { type: Date },
  },
  { timestamps: true }
);

orderSchema.methods.transitionTo = function (newStatus, note) {
  if (!ORDER_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  this.status = newStatus;
  this.statusHistory.push({ status: newStatus, note, at: new Date() });
  return this;
};

module.exports = mongoose.model('Order', orderSchema);
module.exports.ORDER_STATUSES = ORDER_STATUSES;
