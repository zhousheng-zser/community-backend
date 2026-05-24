const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const upload = require('../utils/upload');
const ctrl = require('../modules/message/controllers/message.controller');

router.use(authMiddleware);

router.get('/conversations', ctrl.getConversations);
router.get('/system-notices', ctrl.getSystemNotices);
router.get('/history/:conversationId', ctrl.getHistory);
router.delete('/conversations/:conversationId', ctrl.deleteConversation);
router.post('/send', ctrl.sendMessage);
router.post('/upload', upload.single('file'), ctrl.uploadMedia);
router.post('/order-conversation/ensure', ctrl.ensureOrderConversation);
router.post('/broadcast', ctrl.broadcast);

module.exports = router;
