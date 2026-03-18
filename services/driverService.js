/**
 * Driver Service
 * Business logic for driver registration and status management
 */

const config = require('../config');
const storage = require('../utils/storage');
const logger = require('../utils/logger');
const pincodeService = require('./pincodeDistributionService');
const { DRIVER_STATUS } = config;

/**
 * Register a new driver
 * Auto-triggers PIN code rebalance
 */
function registerDriver(payload) {
  const data = storage.loadData();
  const drivers = data.drivers || [];
  const id = drivers.length ? Math.max(...drivers.map((d) => d.id)) + 1 : 1;
  const franchiseId = payload.franchiseId || 1;
  const franchiseName = payload.franchiseName || 'Jubilee Hills';

  const driver = {
    id,
    name: payload.name || '',
    phone: payload.phone || '',
    email: (payload.email || '').trim().toLowerCase(),
    vehicle: payload.vehicle || 'Bike',
    status: DRIVER_STATUS.AVAILABLE,
    franchiseId,
    franchiseName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  drivers.push(driver);
  data.drivers = drivers;
  storage.saveData(data);

  // Rebalance PIN codes
  pincodeService.rebalancePincodes(franchiseId);

  logger.info('Driver registered', { driverId: id, name: driver.name });
  return driver;
}

/**
 * Update driver status (available | busy | offline)
 */
function updateDriverStatus(driverId, status) {
  const valid = [DRIVER_STATUS.AVAILABLE, DRIVER_STATUS.BUSY, DRIVER_STATUS.OFFLINE];
  if (!valid.includes(status)) {
    return { success: false, error: 'Invalid status' };
  }

  const data = storage.loadData();
  const drivers = data.drivers || [];
  const idx = drivers.findIndex((d) => d.id === driverId);
  if (idx < 0) return { success: false, error: 'Driver not found' };

  drivers[idx].status = status;
  drivers[idx].updatedAt = new Date().toISOString();
  data.drivers = drivers;
  storage.saveData(data);

  logger.info('Driver status updated', { driverId, status });
  return { success: true, driver: drivers[idx] };
}

/**
 * Get drivers for franchise
 */
function getDrivers(franchiseId = null) {
  const data = storage.loadData();
  let drivers = data.drivers || [];
  if (franchiseId != null) {
    drivers = drivers.filter((d) => (d.franchiseId || 1) == franchiseId);
  }
  return drivers;
}

/**
 * Remove driver (soft delete) and rebalance PINs
 */
function removeDriver(driverId) {
  const data = storage.loadData();
  const drivers = data.drivers || [];
  const idx = drivers.findIndex((d) => d.id === driverId);
  if (idx < 0) return { success: false, error: 'Driver not found' };

  const franchiseId = drivers[idx].franchiseId || 1;
  drivers[idx].status = 'deleted';
  drivers[idx].updatedAt = new Date().toISOString();
  data.drivers = drivers;
  storage.saveData(data);

  pincodeService.rebalancePincodes(franchiseId);
  logger.info('Driver removed, PINs rebalanced', { driverId });
  return { success: true };
}

module.exports = {
  registerDriver,
  updateDriverStatus,
  getDrivers,
  removeDriver,
};
