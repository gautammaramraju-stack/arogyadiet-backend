/**
 * Application configuration
 * Centralizes all configurable values for the order assignment system
 */

module.exports = {
  // PIN code service area (Hyderabad)
  PIN_CODE: {
    MIN: 500001,
    MAX: 501510,
    TOTAL: 1510,
  },

  // Order assignment
  ORDER_ASSIGNMENT: {
    /** Time in seconds for driver to accept/decline before auto-reassign */
    ACCEPT_TIMEOUT_SECONDS: 30,
    /** Order status values */
    STATUS: {
      PENDING: 'pending',
      PENDING_ACCEPTANCE: 'pending_acceptance',
      ASSIGNED: 'assigned',
      ACCEPTED: 'accepted',
      DECLINED: 'declined',
      REASSIGNING: 'reassigning',
      DELIVERED: 'delivered',
      FAILED: 'failed',
    },
  },

  // Driver states
  DRIVER_STATUS: {
    AVAILABLE: 'available',
    BUSY: 'busy',
    OFFLINE: 'offline',
  },

  // Data file path
  DATA_FILE: require('path').join(__dirname, '..', 'data.json'),

  // IST timezone
  IST_TZ: 'Asia/Kolkata',
};
