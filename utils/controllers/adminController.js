/**
 * Admin Controller
 * API handlers for admin operations (PIN rebalance, allocations)
 */

const pincodeService = require('../services/pincodeDistributionService');
const { getReqUser } = require('../middlewares/auth');

/**
 * POST /api/v2/admin/pincodes/rebalance
 * Rebalance PIN code distribution among all drivers
 */
function rebalancePincodes(req, res) {
  const user = getReqUser(req);
  const franchiseId = req.body?.franchiseId ?? user.franchiseId ?? 1;
  if (user.role === 'admin' && user.franchiseId != null && user.franchiseId !== franchiseId) {
    return res.status(403).json({ error: 'Cannot rebalance another franchise' });
  }
  const mappings = pincodeService.rebalancePincodes(franchiseId);
  res.json({ success: true, mappingCount: mappings.length });
}

/**
 * GET /api/v2/admin/pincodes/allocations
 * View driver PIN code allocations
 */
function getPincodeAllocations(req, res) {
  const user = getReqUser(req);
  const franchiseId = req.query.franchiseId ? parseInt(req.query.franchiseId, 10) : (user.franchiseId || 1);
  if (user.role === 'admin' && user.franchiseId != null && user.franchiseId !== franchiseId) {
    return res.status(403).json({ error: 'Cannot view another franchise' });
  }
  const summary = pincodeService.getAllocationSummary(franchiseId);
  res.json(summary);
}

module.exports = {
  rebalancePincodes,
  getPincodeAllocations,
};
