/**
 * Driver API routes
 */

const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');
const { requireDriver } = require('../middlewares/auth');

// Public
router.post('/register', driverController.register);

// Driver or admin can update status
router.patch('/:id/status', driverController.updateStatus);

// Driver-only: accept/decline orders
router.post('/orders/:orderId/accept', requireDriver, driverController.acceptOrder);
router.post('/orders/:orderId/decline', requireDriver, driverController.declineOrder);

// Driver: get my PIN codes
router.get('/me/pincodes', requireDriver, driverController.getMyPincodes);

module.exports = router;
