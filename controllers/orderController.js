/**
 * Order Controller
 * API handlers for order creation and assignment
 */

const storage = require('../utils/storage');
const orderAssignmentService = require('../services/orderAssignmentService');
const logger = require('../utils/logger');

/**
 * POST /api/v2/orders
 * Create order and auto-assign to driver
 */
function createOrder(req, res) {
  const body = req.body || {};
  const {
    customerName,
    email,
    phone,
    address,
    pincode,
    delivery_date,
    subscriptionId,
    franchiseId,
    franchiseName,
    mealType,
    allergies,
  } = body;

  if (!customerName || !address || !pincode || !delivery_date) {
    return res.status(400).json({
      error: 'customerName, address, pincode, delivery_date are required',
    });
  }

  const data = storage.loadData();
  const orders = data.orders || [];
  const id = orders.length ? Math.max(...orders.map((o) => o.id)) + 1 : 1;

  const order = {
    id,
    subscriptionId: subscriptionId || null,
    customerName,
    email: email || '',
    phone: phone || '',
    address,
    pincode: String(pincode).trim(),
    delivery_date: String(delivery_date).slice(0, 10),
    status: 'pending',
    driverId: null,
    driverName: null,
    driverPhone: null,
    franchiseId: franchiseId || 1,
    franchiseName: franchiseName || 'Jubilee Hills',
    mealType: mealType || 'veg',
    allergies: Array.isArray(allergies) ? allergies : [],
    declinedByDriverIds: [],
    createdAt: new Date().toISOString(),
  };

  orders.push(order);
  data.orders = orders;
  storage.saveData(data);

  // Auto-assign
  const assigned = orderAssignmentService.assignOrderOnCreate(order);

  res.status(201).json(assigned);
}

/**
 * PATCH /api/v2/orders/:id/assign
 * Manually assign order to driver (admin)
 */
function assignOrder(req, res) {
  const orderId = parseInt(req.params.id, 10);
  const { driverId } = req.body || {};
  if (!driverId) {
    return res.status(400).json({ error: 'driverId is required' });
  }

  const data = storage.loadData();
  const orders = data.orders || [];
  const drivers = data.drivers || [];
  const orderIdx = orders.findIndex((o) => o.id === orderId);
  const driver = drivers.find((d) => d.id === driverId);

  if (orderIdx < 0) return res.status(404).json({ error: 'Order not found' });
  if (!driver) return res.status(404).json({ error: 'Driver not found' });

  orderAssignmentService.clearOrderTimeout(orderId);
  const updated = orderAssignmentService.assignOrderToDriver(orderId, driver);
  res.json(updated);
}

/**
 * PATCH /api/v2/orders/:id/reassign
 * Reassign order to next available driver
 */
function reassignOrder(req, res) {
  const orderId = parseInt(req.params.id, 10);
  const updated = orderAssignmentService.reassignOrder(orderId);
  if (!updated) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json(updated);
}

/**
 * GET /api/v2/orders
 * List orders (filter by deliveryDate, franchiseId, driverId, status)
 */
function listOrders(req, res) {
  const { deliveryDate, franchiseId, driverId, status } = req.query;
  const data = storage.loadData();
  let orders = data.orders || [];

  if (deliveryDate) orders = orders.filter((o) => o.delivery_date === deliveryDate);
  if (franchiseId) orders = orders.filter((o) => (o.franchiseId || 1) == franchiseId);
  if (driverId) orders = orders.filter((o) => o.driverId == driverId);
  if (status) orders = orders.filter((o) => o.status === status);

  res.json(orders);
}

module.exports = {
  createOrder,
  assignOrder,
  reassignOrder,
  listOrders,
};
