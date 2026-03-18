/**
 * Order API routes
 */

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { requireAdmin } = require('../middlewares/auth');

router.post('/', orderController.createOrder);
router.get('/', orderController.listOrders);
router.patch('/:id/assign', requireAdmin, orderController.assignOrder);
router.patch('/:id/reassign', requireAdmin, orderController.reassignOrder);

module.exports = router;
