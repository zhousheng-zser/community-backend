const express = require('express');
const router = express.Router();
const communityList = require('../controllers/communityListController');

/** GET /api/v1/geo/communities — 小区列表（前端地理/入驻选社区） */
router.get('/communities', communityList.getCommunities);
router.post('/communities/resolve', communityList.resolveCommunity);

module.exports = router;
