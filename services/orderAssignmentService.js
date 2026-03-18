/**
 * Order Assignment Service
 * Handles order lifecycle: assign → accept/decline/timeout → reassign
 */

const config = require('../config');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const pincodeService = require('./pincodeDistributionService');
const { ORDER_ASSIGNMENT, DRIVER_STATUS } = config;

const ACCEPT_TIMEOUT_MS = (ORDER_ASSIGNMENT.ACCEPT_TIMEOUT_SECONDS || 30) * 1000;
const orderTimeouts = new Map(); // orderId -> timeout handle

/**
 * Clear timeout for an order (when accepted or reassigned)
 */
function clearOrderTimeout(orderId) {
  if (orderTimeouts.has(orderId)) {
    clearTimeout(orderTimeouts.get(orderId));
    orderTimeouts.delete(orderId);
  }
}

/**
 * Find next available driver for an order
 * Priority: 1) PIN-assigned driver (if available), 2) Other available drivers (round-robin)
 * Excludes drivers who have already declined
 */
function findNextDriver(order, franchiseId) {
  const data = storage.loadData();
  const drivers = (data.drivers || []).filter(
    (d) =>
      (d.franchiseId || 1) == franchiseId &&
      (d.status === DRIVER_STATUS.AVAILABLE || d.status === 'active') &&
      (d.status || '') !== 'deleted' &&
      !(order.declinedByDriverIds || []).includes(d.id)
  );

  if (drivers.length === 0) return null;

  // First try: PIN-assigned driver
  const pincode = parseInt(String(order.pincode || '').trim(), 10);
  if (!isNaN(pincode)) {
    const pinDriverId = pincodeService.getDriverForPincode(pincode, franchiseId);
    const pinDriver = drivers.find((d) => d.id === pinDriverId);
    if (pinDriver) return pinDriver;
  }

  // Fallback: least-loaded available driver (by today's assigned count)
  const today = order.delivery_date || new Date().toISOString().split('T')[0];
  const orders = data.orders || [];
  const todayAssigned = orders.filter(
    (o) => o.delivery_date === today && o.driverId && ['assigned', 'accepted', 'pending_acceptance'].includes(o.status)
  );
  const countByDriver = {};
  todayAssigned.forEach((o) => {
    countByDriver[o.driverId] = (countByDriver[o.driverId] || 0) + 1;
  });

  const sorted = drivers
    .map((d) => ({ driver: d, count: countByDriver[d.id] || 0 }))
    .sort((a, b) => a.count - b.count);
  return sorted[0] ? sorted[0].driver : null;
}

/**
 * Assign order to a driver and start acceptance timeout
 */
function assignOrderToDriver(orderId, driver) {
  const data = storage.loadData();
  const orders = data.orders || [];
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return null;

  const order = orders[idx];
  order.driverId = driver.id;
  order.driverName = driver.name;
  order.driverPhone = driver.phone || '';
  order.status = ORDER_ASSIGNMENT.STATUS.PENDING_ACCEPTANCE;
  order.assignedAt = new Date().toISOString();
  data.orders = orders;
  storage.saveData(data);

  // Start timeout for auto-reassign
  const timeoutHandle = setTimeout(() => {
    handleAcceptTimeout(orderId);
  }, ACCEPT_TIMEOUT_MS);
  orderTimeouts.set(orderId, timeoutHandle);

  logger.info('Order assigned to driver', {
    orderId,
    driverId: driver.id,
    driverName: driver.name,
    timeoutSeconds: ORDER_ASSIGNMENT.ACCEPT_TIMEOUT_SECONDS,
  });

  return order;
}

/**
 * Handle timeout - reassign to next driver
 */
function handleAcceptTimeout(orderId) {
  orderTimeouts.delete(orderId); // Clear from map (timeout already fired)
  const data = storage.loadData();
  const orders = data.orders || [];
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return;

  const order = orders[idx];
  if (order.status !== ORDER_ASSIGNMENT.STATUS.PENDING_ACCEPTANCE) return; // Already accepted/declined

  const driverId = order.driverId;
  const driverName = order.driverName;
  order.declinedByDriverIds = order.declinedByDriverIds || [];
  order.declinedByDriverIds.push(driverId);
  order.driverId = null;
  order.driverName = null;
  order.driverPhone = null;
  order.status = ORDER_ASSIGNMENT.STATUS.REASSIGNING;
  order.assignedAt = null;
  data.orders = orders;
  storage.saveData(data);

  logger.info('Order acceptance timeout - reassigning', { orderId, timedOutDriverId: driverId });

  reassignOrder(orderId);
}

/**
 * Reassign order to next available driver
 */
function reassignOrder(orderId) {
  const data = storage.loadData();
  const orders = data.orders || [];
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return null;

  const order = orders[idx];
  const franchiseId = order.franchiseId || 1;
  const driver = findNextDriver(order, franchiseId);

  if (!driver) {
    order.status = ORDER_ASSIGNMENT.STATUS.PENDING;
    order.declinedByDriverIds = [];
    data.orders = orders;
    storage.saveData(data);
    logger.warn('No available driver for order - set to pending', { orderId });
    return order;
  }

  return assignOrderToDriver(orderId, driver);
}

/**
 * Driver accepts order
 */
function acceptOrder(orderId, driverId) {
  clearOrderTimeout(orderId);
  const data = storage.loadData();
  const orders = data.orders || [];
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return { success: false, error: 'Order not found' };
  if (orders[idx].driverId !== driverId) return { success: false, error: 'Order not assigned to you' };
  if (orders[idx].status !== ORDER_ASSIGNMENT.STATUS.PENDING_ACCEPTANCE) {
    return { success: false, error: 'Order already accepted or reassigned' };
  }

  orders[idx].status = ORDER_ASSIGNMENT.STATUS.ACCEPTED;
  orders[idx].acceptedAt = new Date().toISOString();
  // Also set status for backward compat with existing UI (assigned = accepted)
  data.orders = orders;
  storage.saveData(data);

  // Update driver to busy
  const drivers = data.drivers || [];
  const dIdx = drivers.findIndex((d) => d.id === driverId);
  if (dIdx >= 0) {
    drivers[dIdx].status = DRIVER_STATUS.BUSY;
    drivers[dIdx].updatedAt = new Date().toISOString();
    data.drivers = drivers;
    storage.saveData(data);
  }

  logger.info('Order accepted by driver', { orderId, driverId });
  return { success: true, order: orders[idx] };
}

/**
 * Driver declines order
 */
function declineOrder(orderId, driverId) {
  clearOrderTimeout(orderId);
  const data = storage.loadData();
  const orders = data.orders || [];
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return { success: false, error: 'Order not found' };
  if (orders[idx].driverId !== driverId) return { success: false, error: 'Order not assigned to you' };
  if (orders[idx].status !== ORDER_ASSIGNMENT.STATUS.PENDING_ACCEPTANCE) {
    return { success: false, error: 'Order already accepted or reassigned' };
  }

  const order = orders[idx];
  order.declinedByDriverIds = order.declinedByDriverIds || [];
  order.declinedByDriverIds.push(driverId);
  order.driverId = null;
  order.driverName = null;
  order.driverPhone = null;
  order.status = ORDER_ASSIGNMENT.STATUS.REASSIGNING;
  order.declinedAt = new Date().toISOString();
  order.assignedAt = null;
  data.orders = orders;
  storage.saveData(data);

  logger.info('Order declined by driver', { orderId, driverId });

  // Reassign to next driver
  const reassigned = reassignOrder(orderId);
  return { success: true, reassigned: !!reassigned };
}

/**
 * Initial assignment when order is created
 * Called from subscription/order creation flow
 */
function assignOrderOnCreate(order) {
  const franchiseId = order.franchiseId || 1;
  const driver = findNextDriver(order, franchiseId);
  if (driver) {
    return assignOrderToDriver(order.id, driver);
  }
  return order;
}

module.exports = {
  assignOrderToDriver,
  reassignOrder,
  acceptOrder,
  declineOrder,
  assignOrderOnCreate,
  findNextDriver,
  clearOrderTimeout,
};
