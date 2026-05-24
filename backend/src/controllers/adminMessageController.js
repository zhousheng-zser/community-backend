const { Op } = require('sequelize');
const { Message, Conversation, UserConversation, User } = require('../models');
const messageController = require('../modules/message/controllers/message.controller');

/**
 * GET /api/v1/admin/messages/overview
 */
exports.overview = async (req, res) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalUsers, totalConversations, messages24h, messages7d, userConvCount] =
      await Promise.all([
        User.count(),
        Conversation.count(),
        Message.count({ where: { created_at: { [Op.gte]: since24h } } }),
        Message.count({ where: { created_at: { [Op.gte]: since7d } } }),
        UserConversation.count()
      ]);

    res.json({
      message: 'ok',
      data: {
        total_users: totalUsers,
        total_conversations: totalConversations,
        user_conversation_mappings: userConvCount,
        messages_last_24h: messages24h,
        messages_last_7d: messages7d
      }
    });
  } catch (e) {
    console.error('adminMessage overview', e);
    res.status(500).json({ error: '统计失败' });
  }
};

/** POST /api/v1/admin/messages/broadcast */
exports.broadcast = (req, res) => messageController.broadcast(req, res);
