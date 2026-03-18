/**
 * Storage layer - JSON file persistence
 * Abstracts data access for easy migration to DB (MySQL, PostgreSQL)
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const DATA_FILE = config.DATA_FILE || path.join(__dirname, '..', 'data.json');

/**
 * Load full data from storage
 */
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const d = JSON.parse(raw);
    return {
      users: d.users || {},
      franchises: d.franchises || [],
      customers: d.customers || [],
      subscriptions: d.subscriptions || [],
      drivers: d.drivers || [],
      deliveries: d.deliveries || [],
      orders: d.orders || [],
      driverPincodeMappings: d.driverPincodeMappings || [],
      driverLocationLog: d.driverLocationLog || [],
      notifications: d.notifications || [],
    };
  } catch (e) {
    return {
      users: {},
      franchises: [],
      customers: [],
      subscriptions: [],
      drivers: [],
      deliveries: [],
      orders: [],
      driverPincodeMappings: [],
      driverLocationLog: [],
      notifications: [],
    };
  }
}

/**
 * Save full data to storage
 */
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * Atomic read-modify-write
 */
function updateData(updater) {
  const data = loadData();
  updater(data);
  saveData(data);
  return data;
}

module.exports = {
  loadData,
  saveData,
  updateData,
};
