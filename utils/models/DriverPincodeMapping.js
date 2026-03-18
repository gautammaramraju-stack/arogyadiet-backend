/**
 * DriverPincodeMapping model
 * Maps PIN codes to drivers for order routing
 */

/**
 * DriverPincodeMapping schema
 * @typedef {Object} DriverPincodeMapping
 * @property {number} driverId - Driver ID
 * @property {number} pincode - PIN code (500001-501510)
 * @property {number} [franchiseId] - Franchise ID
 * @property {string} [createdAt] - ISO timestamp
 */

function createMapping(driverId, pincode, franchiseId = 1) {
  return {
    driverId,
    pincode,
    franchiseId,
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  createMapping,
};
