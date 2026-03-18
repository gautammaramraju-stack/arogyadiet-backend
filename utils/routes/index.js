/**
 * Route aggregator
 * Mounts all API routes under /api/v2
 */

const express = require('express');
const router = express.Router();
const driverRoutes = require('./driverRoutes');
const orderRoutes = require('./orderRoutes');
const adminRoutes = require('./adminRoutes');

router.use('/drivers', driverRoutes);
router.use('/orders', orderRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
