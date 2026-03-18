/**
 * Driver Controller
 * API handlers for driver operations
 */

const driverService = require('../services/driverService');
const orderAssignmentService = require('../services/orderAssignmentService');
const pincodeService = require('../services/pincodeDistributionService');
const { getReqUser, requireDriver } = require('../middlewares/auth');

/**
 * POST /api/v2/drivers/register
 * Register a new driver
 */
function register(req, res) {
  const { name, phone, email, vehicle, franchiseId, franchiseName } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and phone are required' });
  }
  try {
    const driver = driverService.registerDriver({
      name,
      phone,
      email,
      vehicle: vehicle || 'Bike',
      franchiseId: franchiseId || 1,
      franchiseName: franchiseName || 'Jubilee Hills',
    });
    res.status(201).json(driver);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to register driver' });
  }
}

/**
 * PATCH /api/v2/drivers/:id/status
 * Update driver status (available | busy | offline)
 */
function updateStatus(req, res) {
  const driverId = parseInt(req.params.id, 10);
  const user = getReqUser(req);
  if (user.role === 'driver' && user.driverId !== driverId) {
    return res.status(403).json({ error: 'Cannot update another driver' });
  }
  const { status } = req.body || {};
  if (!status) {
    return res.status(400).json({ error: 'Status is required' });
  }
  const result = driverService.updateDriverStatus(driverId, status);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json(result.driver);
}

/**
 * POST /api/v2/drivers/orders/:orderId/accept
 * Driver accepts order (requires driver auth)
 */
function acceptOrder(req, res) {
  const orderId = parseInt(req.params.orderId, 10);
  const user = getReqUser(req);
  if (user.role !== 'driver' || !user.driverId) {
    return res.status(403).json({ error: 'Driver access required' });
  }
  const result = orderAssignmentService.acceptOrder(orderId, user.driverId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true, order: result.order });
}

/**
 * POST /api/v2/drivers/orders/:orderId/decline
 * Driver declines order (requires driver auth)
 */
function declineOrder(req, res) {
  const orderId = parseInt(req.params.orderId, 10);
  const user = getReqUser(req);
  if (user.role !== 'driver' || !user.driverId) {
    return res.status(403).json({ error: 'Driver access required' });
  }
  const result = orderAssignmentService.declineOrder(orderId, user.driverId);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true, reassigned: result.reassigned });
}

/**
 * GET /api/v2/drivers/me/pincodes
 * Get PIN codes assigned to logged-in driver
 */
function getMyPincodes(req, res) {
  const user = getReqUser(req);
  if (user.role !== 'driver' || !user.driverId) {
    return res.status(403).json({ error: 'Driver access required' });
  }
  const franchiseId = user.franchiseId || 1;
  const pincodes = pincodeService.getPincodesForDriver(user.driverId, franchiseId);
  res.json({ driverId: user.driverId, pincodes });
}

module.exports = {
  register,
  updateStatus,
  acceptOrder,
  declineOrder,
  getMyPincodes,
};
