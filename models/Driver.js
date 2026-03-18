/**
 * Driver model
 * Represents a delivery partner with status and PIN code assignments
 */

const { DRIVER_STATUS } = require('../config');

/**
 * Driver schema
 * @typedef {Object} Driver
 * @property {number} id - Unique driver ID
 * @property {string} name - Driver name
 * @property {string} phone - Contact phone
 * @property {string} [email] - Email for login
 * @property {string} [vehicle] - Bike, Scooter, Car
 * @property {string} status - available | busy | offline
 * @property {number} [franchiseId] - Franchise ID
 * @property {string} [franchiseName] - Franchise name
 * @property {string} [createdAt] - ISO timestamp
 * @property {string} [updatedAt] - ISO timestamp
 */

function createDriver(overrides = {}) {
  return {
    id: null,
    name: '',
    phone: '',
    email: '',
    vehicle: 'Bike',
    status: DRIVER_STATUS.AVAILABLE,
    franchiseId: 1,
    franchiseName: 'Jubilee Hills',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function isAvailable(driver) {
  return driver && driver.status === DRIVER_STATUS.AVAILABLE;
}

module.exports = {
  createDriver,
  isAvailable,
};
