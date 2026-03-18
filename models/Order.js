/**
 * Order model
 * Represents a delivery order with assignment state
 */

const { ORDER_ASSIGNMENT } = require('../config');

/**
 * Order schema
 * @typedef {Object} Order
 * @property {number} id - Unique order ID
 * @property {number} [subscriptionId] - Linked subscription ID
 * @property {string} customerName - Customer name
 * @property {string} [email] - Customer email
 * @property {string} [phone] - Customer phone
 * @property {string} address - Delivery address
 * @property {string} pincode - Delivery PIN code (500001-501510)
 * @property {string} delivery_date - YYYY-MM-DD
 * @property {string} status - pending | pending_acceptance | assigned | accepted | declined | reassigning | delivered | failed
 * @property {number|null} driverId - Assigned driver ID
 * @property {string|null} driverName - Assigned driver name
 * @property {string|null} driverPhone - Assigned driver phone
 * @property {number} [franchiseId] - Franchise ID
 * @property {string} [franchiseName] - Franchise name
 * @property {string} [assignedAt] - When assigned to current driver
 * @property {string} [acceptedAt] - When driver accepted
 * @property {string} [declinedAt] - When driver declined
 * @property {number[]} [declinedByDriverIds] - Driver IDs who declined (for rotation)
 * @property {string} [createdAt] - ISO timestamp
 */

function createOrder(overrides = {}) {
  return {
    id: null,
    subscriptionId: null,
    customerName: '',
    email: '',
    phone: '',
    address: '',
    pincode: '',
    delivery_date: '',
    status: ORDER_ASSIGNMENT.STATUS.PENDING,
    driverId: null,
    driverName: null,
    driverPhone: null,
    franchiseId: 1,
    franchiseName: 'Jubilee Hills',
    assignedAt: null,
    acceptedAt: null,
    declinedAt: null,
    declinedByDriverIds: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function isPendingAcceptance(order) {
  return order && order.status === ORDER_ASSIGNMENT.STATUS.PENDING_ACCEPTANCE;
}

function isAssigned(order) {
  return order && (order.status === ORDER_ASSIGNMENT.STATUS.ASSIGNED || order.status === ORDER_ASSIGNMENT.STATUS.ACCEPTED);
}

module.exports = {
  createOrder,
  isPendingAcceptance,
  isAssigned,
};
