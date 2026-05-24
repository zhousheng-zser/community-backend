const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/serviceCartController');

router.get('/summary', authMiddleware, ctrl.getCartSummary);
router.get('/', authMiddleware, ctrl.getCart);
router.post('/items', authMiddleware, ctrl.addItem);
router.put('/items/:itemId', authMiddleware, ctrl.updateItem);
router.delete('/items/:itemId', authMiddleware, ctrl.deleteItem);
router.delete('/', authMiddleware, ctrl.clearCart);

module.exports = router;
