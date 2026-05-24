const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middlewares/authMiddleware');
const ctrl = require('./controllers/user.controller');

router.use(authMiddleware);

router.get('/profile', ctrl.getProfile);
router.patch('/profile', ctrl.updateProfile);
router.get('/addresses', ctrl.getAddresses);
router.post('/addresses', ctrl.addAddress);
router.post('/addresses/:id', ctrl.updateAddress);
router.delete('/addresses/:id', ctrl.deleteAddress);
router.get('/invite-code', ctrl.getInviteCode);
router.post('/bind-inviter', ctrl.bindInviter);
router.get('/invitees', ctrl.getInvitees);
router.post('/footprints', ctrl.recordFootprint);
router.post('/footprints/batch', ctrl.batchFootprints);
router.get('/footprints', ctrl.getFootprints);
router.delete('/footprints', ctrl.clearFootprints);
router.post('/service-favorites', ctrl.addServiceFav);
router.post('/service-favorites/remove', ctrl.removeServiceFav);
router.get('/service-favorites', ctrl.getServiceFavs);
router.post('/service-favorites/batch', ctrl.batchServiceFavs);
router.get('/service-favorites/check', ctrl.checkServiceFav);

// 用户社区绑定管理
router.get('/community-bindings', ctrl.getUserCommunityBindings);
router.post('/community-bindings', ctrl.bindCommunity);
router.delete('/community-bindings/:communityId', ctrl.unbindCommunity);
router.patch('/community-bindings/active', ctrl.switchActiveCommunity);

module.exports = router;
