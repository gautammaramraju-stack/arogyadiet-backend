/**
 * Admin API routes
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middlewares/auth');

router.post('/pincodes/rebalance', requireAdmin, adminController.rebalancePincodes);
router.get('/pincodes/allocations', requireAdmin, adminController.getPincodeAllocations);

module.exports = router;
