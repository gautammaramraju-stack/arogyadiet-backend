/**
 * PIN Code Distribution Service
 * Distributes 500001-501510 (1510 PINs) equally among drivers
 * Auto-rebalances when drivers are added/removed
 */

const config = require('../config');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

const { PIN_CODE } = config;
const TOTAL_PINS = PIN_CODE.TOTAL; // 1510

/**
 * Get all PIN codes in service area
 */
function getAllPincodes() {
  const pincodes = [];
  for (let p = PIN_CODE.MIN; p <= PIN_CODE.MAX; p++) {
    pincodes.push(p);
  }
  return pincodes;
}

/**
 * Rebalance PIN code distribution among all active drivers for a franchise
 * @param {number} franchiseId - Franchise ID
 * @returns {Object[]} driverPincodeMappings - Array of { driverId, pincode, franchiseId }
 */
function rebalancePincodes(franchiseId = 1) {
  const data = storage.loadData();
  const drivers = (data.drivers || []).filter(
    (d) => (d.franchiseId || 1) == franchiseId && (d.status || 'active') !== 'deleted'
  );
  const existingMappings = (data.driverPincodeMappings || []).filter((m) => (m.franchiseId || 1) == franchiseId);

  // Remove old mappings for this franchise
  data.driverPincodeMappings = (data.driverPincodeMappings || []).filter((m) => (m.franchiseId || 1) !== franchiseId);

  if (drivers.length === 0) {
    storage.saveData(data);
    logger.info('PIN rebalance: No drivers, no mappings created', { franchiseId });
    return [];
  }

  const pincodes = getAllPincodes();
  const perDriver = Math.floor(TOTAL_PINS / drivers.length);
  const remainder = TOTAL_PINS % drivers.length;

  const mappings = [];
  let idx = 0;

  drivers.forEach((driver, i) => {
    const count = perDriver + (i < remainder ? 1 : 0);
    const assigned = pincodes.slice(idx, idx + count);
    idx += count;

    assigned.forEach((pincode) => {
      mappings.push({
        driverId: driver.id,
        pincode,
        franchiseId,
        createdAt: new Date().toISOString(),
      });
    });
  });

  data.driverPincodeMappings = (data.driverPincodeMappings || []).concat(mappings);
  storage.saveData(data);

  logger.info('PIN rebalance completed', {
    franchiseId,
    driverCount: drivers.length,
    mappingCount: mappings.length,
    perDriver: Math.floor(TOTAL_PINS / drivers.length),
  });

  return mappings;
}

/**
 * Get driver ID responsible for a PIN code
 * @param {number|string} pincode - Delivery PIN code
 * @param {number} franchiseId - Franchise ID
 * @returns {number|null} driverId - Driver responsible for this PIN, or null
 */
function getDriverForPincode(pincode, franchiseId = 1) {
  const pin = parseInt(String(pincode).trim(), 10);
  if (isNaN(pin) || pin < PIN_CODE.MIN || pin > PIN_CODE.MAX) {
    return null;
  }

  const data = storage.loadData();
  const mappings = data.driverPincodeMappings || [];
  const mapping = mappings.find((m) => m.pincode === pin && (m.franchiseId || 1) == franchiseId);
  return mapping ? mapping.driverId : null;
}

/**
 * Get PIN codes assigned to a driver
 * @param {number} driverId - Driver ID
 * @param {number} franchiseId - Franchise ID
 * @returns {number[]} pincodes - Array of PIN codes
 */
function getPincodesForDriver(driverId, franchiseId = 1) {
  const data = storage.loadData();
  const mappings = (data.driverPincodeMappings || []).filter(
    (m) => m.driverId === driverId && (m.franchiseId || 1) == franchiseId
  );
  return mappings.map((m) => m.pincode).sort((a, b) => a - b);
}

/**
 * Get allocation summary for admin view
 * @param {number} franchiseId - Franchise ID
 * @returns {Object[]} - [{ driverId, driverName, pincodeCount, pincodes }]
 */
function getAllocationSummary(franchiseId = 1) {
  const data = storage.loadData();
  const drivers = (data.drivers || []).filter((d) => (d.franchiseId || 1) == franchiseId);
  const mappings = (data.driverPincodeMappings || []).filter((m) => (m.franchiseId || 1) == franchiseId);

  const byDriver = {};
  mappings.forEach((m) => {
    if (!byDriver[m.driverId]) byDriver[m.driverId] = [];
    byDriver[m.driverId].push(m.pincode);
  });

  return drivers.map((d) => ({
    driverId: d.id,
    driverName: d.name,
    pincodeCount: (byDriver[d.id] || []).length,
    pincodes: (byDriver[d.id] || []).sort((a, b) => a - b),
  }));
}

module.exports = {
  rebalancePincodes,
  getDriverForPincode,
  getPincodesForDriver,
  getAllocationSummary,
  getAllPincodes,
  PIN_CODE,
};
