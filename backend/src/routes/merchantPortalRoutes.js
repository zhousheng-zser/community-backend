const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const shopCtrl = require('../controllers/merchantShopController');

router.use(authMiddleware);

router.get('/shop', shopCtrl.getShop);
router.patch('/shop', shopCtrl.patchShop);

module.exports = router;
