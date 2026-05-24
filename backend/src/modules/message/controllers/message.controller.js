const db = require('../../../models');
const { Conversation, UserConversation, Message, User, MarketOrder, NeighborAssistOrder, sequelize } = db;
const { resolveUserId, resolveUserIdFromReq } = require('../../../utils/resolveUserId');

const ok = (res, data) => res.json({ errcode: 0, code: 0, errno: 0, msg: 'ok', data });
const fail = (res, msg, status = 400, code = 1) =>
  res.status(status).json({ errcode: code, code, errno: code, msg, errmsg: msg });

const SYSTEM_BOT_TYPES = ['event', 'logistics', 'notices', 'service'];
const ORDER_SCOPED_CHANNELS = new Set([
  'neighbor_assist',
  'shop_buyer',
  'shop_rider',
  'worker_customer',
  'merchant_customer'
]);
let messageTablesReady = false;

async function ensureMessageColumns() {
  if (!sequelize || !sequelize.getQueryInterface) return;
  const qi = sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable('userconversations');
    if (!desc.order_id) {
      await qi.addColumn('userconversations', 'order_id', {
        type: require('sequelize').DataTypes.BIGINT.UNSIGNED,
        allowNull: true
      });
    }
    if (!desc.order_no) {
      await qi.addColumn('userconversations', 'order_no', {
        type: require('sequelize').DataTypes.STRING(64),
        allowNull: true
      });
    }
  } catch (e) {
    console.warn('[messages] ensureMessageColumns', e.message);
  }
}

async function ensureMessageTables() {
  if (messageTablesReady) return;
  await ensureMessageColumns();
  await Promise.all([
    Conversation && Conversation.sync ? Conversation.sync() : Promise.resolve(),
    UserConversation && UserConversation.sync ? UserConversation.sync() : Promise.resolve(),
    Message && Message.sync ? Message.sync() : Promise.resolve()
  ]);
  messageTablesReady = true;
}

function uid(req) {
  return resolveUserIdFromReq(req);
}

function previewText(content, msgType) {
  if (msgType === 'image') return '[图片]';
  if (msgType === 'audio') return '[语音]';
  const s = String(content || '').trim();
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function extractOrderNo(preview) {
  const m = String(preview || '').match(/订单沟通\s*(\S+)/);
  return m ? m[1] : '';
}

function formatConvRow(row) {
  const plain = row.get ? row.get({ plain: true }) : row;
  const conv = plain.conversation || {};
  const peerUser = plain.peerUser || null;
  const orderNo = extractOrderNo(conv.last_message_preview);
  const botNames = {
    logistics: '订单物流通知',
    event: '活动优惠',
    notices: '系统公告',
    service: '服务通知',
    shop_buyer: '订单沟通',
    shop_rider: '配送沟通',
    merchant_customer: '服务沟通',
    worker_customer: '服务沟通',
    neighbor_assist: '邻里帮沟通'
  };
  let title = plain.title;
  if (!title && plain.bot_type === 'neighbor_assist' && (plain.order_no || orderNo)) {
    title = `邻里帮 ${plain.order_no || orderNo}`;
  }
  if (!title && plain.bot_type) title = botNames[plain.bot_type] || '系统通知';
  if (!title && peerUser && peerUser.nickname) title = peerUser.nickname;
  if (!title) title = '会话';
  return Object.assign({}, plain, {
    conversation_id: plain.conversation_id,
    conversation: conv,
    peerUser,
    title,
    order_id: plain.order_id != null ? plain.order_id : null,
    order_no: plain.order_no || orderNo,
    unread_count: plain.unread_count || 0
  });
}

function orderScopeFromBody(body, channel) {
  const scope = {};
  if (!ORDER_SCOPED_CHANNELS.has(channel)) return scope;
  const orderIdNum = body && body.order_id != null ? Number(body.order_id) : 0;
  const orderNo = body && body.order_no != null ? String(body.order_no).trim() : '';
  if (Number.isFinite(orderIdNum) && orderIdNum > 0) scope.order_id = orderIdNum;
  else if (orderNo) scope.order_no = orderNo;
  return scope;
}

async function ensureUserOrderMapping({ me, peerId, channel, orderId, orderNo, preview, transaction }) {
  const scope = {};
  if (orderId != null && Number(orderId) > 0) scope.order_id = Number(orderId);
  if (orderNo) scope.order_no = String(orderNo);

  const lookupWhere = Object.assign({ user_id: me, peer_id: peerId, bot_type: channel }, scope);
  let mapping = await UserConversation.findOne({ where: lookupWhere, transaction });
  let conversationId = mapping && mapping.conversation_id;

  if (!conversationId) {
    const conv = await Conversation.create({ type: 'private', last_message_preview: preview }, { transaction });
    conversationId = conv.id;
    await UserConversation.create(
      Object.assign(
        {
          user_id: me,
          peer_id: peerId,
          conversation_id: conversationId,
          bot_type: channel,
          unread_count: 0,
          is_deleted: false
        },
        scope
      ),
      { transaction }
    );
    const reverseWhere = Object.assign({ user_id: peerId, peer_id: me, bot_type: channel }, scope);
    await UserConversation.findOrCreate({
      where: reverseWhere,
      defaults: Object.assign(
        { conversation_id: conversationId, unread_count: 0, is_deleted: false },
        scope
      ),
      transaction
    });
  } else {
    await Conversation.update(
      { last_message_preview: preview, updated_at: new Date() },
      { where: { id: conversationId }, transaction }
    );
    await UserConversation.update(
      { is_deleted: false },
      { where: { user_id: me, conversation_id: conversationId }, transaction }
    );
  }
  return conversationId;
}

async function resolvePeerForSend(senderId, body, transaction) {
  let peerId = resolveUserId(body && body.peerId);
  const conversationId = body && body.conversationId != null ? Number(body.conversationId) : 0;
  if ((!peerId || peerId === '0') && conversationId > 0) {
    const uc = await UserConversation.findOne({
      where: { user_id: senderId, conversation_id: conversationId },
      transaction
    });
    if (uc && uc.peer_id != null) peerId = String(uc.peer_id);
  }
  return { peerId, conversationId };
}

// GET /messages/conversations
exports.getConversations = async (req, res) => {
  try {
    await ensureMessageTables();
    const me = uid(req);
    if (!me) return fail(res, '未登录', 401, 401);

    const shopId = req.query.shop_id != null ? String(req.query.shop_id).trim() : '';
    const where = { user_id: me, is_deleted: false };
    if (shopId) {
      where.bot_type = 'shop_buyer';
    }

    const rows = await UserConversation.findAll({
      where,
      include: [
        { model: Conversation, as: 'conversation', required: false },
        { model: User, as: 'peerUser', attributes: ['id', 'nickname', 'avatar_url'], required: false }
      ],
      order: [[{ model: Conversation, as: 'conversation' }, 'updated_at', 'DESC']]
    });

    const list = rows
      .filter((r) => !SYSTEM_BOT_TYPES.includes(String(r.bot_type || '')))
      .map(formatConvRow);
    ok(res, list);
  } catch (e) {
    console.error('getConversations error', e);
    fail(res, '无法获取消息列表', 500, 500);
  }
};

// GET /messages/system-notices
exports.getSystemNotices = async (req, res) => {
  try {
    await ensureMessageTables();
    const me = uid(req);
    if (!me) return fail(res, '未登录', 401, 401);

    const rows = await UserConversation.findAll({
      where: {
        user_id: me,
        is_deleted: false,
        bot_type: SYSTEM_BOT_TYPES
      },
      include: [{ model: Conversation, as: 'conversation', required: false }],
      order: [[{ model: Conversation, as: 'conversation' }, 'updated_at', 'DESC']]
    });

    const list = rows.map((row) => {
      const item = formatConvRow(row);
      const conv = item.conversation || {};
      return {
        id: item.conversation_id,
        title: item.title,
        content: conv.last_message_preview || '',
        time: conv.updated_at || item.updated_at,
        read: (item.unread_count || 0) === 0,
        unread_count: item.unread_count || 0,
        bot_type: item.bot_type
      };
    });
    ok(res, list);
  } catch (e) {
    console.error('getSystemNotices error', e);
    fail(res, '无法获取系统通知', 500, 500);
  }
};

// GET /messages/history/:conversationId
exports.getHistory = async (req, res) => {
  try {
    await ensureMessageTables();
    const me = uid(req);
    if (!me) return fail(res, '未登录', 401, 401);
    const conversationId = Number(req.params.conversationId);
    if (!conversationId) return fail(res, '无效会话ID');

    const uc = await UserConversation.findOne({ where: { user_id: me, conversation_id: conversationId } });
    if (!uc) return fail(res, '无权访问该会话', 403, 403);

    const list = await Message.findAll({
      where: { conversation_id: conversationId },
      include: [{ model: User, as: 'sender', attributes: ['id', 'nickname', 'avatar_url'], required: false }],
      order: [['created_at', 'ASC']]
    });

    await UserConversation.update({ unread_count: 0 }, { where: { user_id: me, conversation_id: conversationId } });
    ok(res, list);
  } catch (e) {
    console.error('getHistory error', e);
    fail(res, '无法获取历史消息', 500, 500);
  }
};

// DELETE /messages/conversations/:conversationId
exports.deleteConversation = async (req, res) => {
  try {
    await ensureMessageTables();
    const me = uid(req);
    if (!me) return fail(res, '未登录', 401, 401);
    const conversationId = Number(req.params.conversationId);
    if (!conversationId) return fail(res, '无效会话ID');
    await UserConversation.update(
      { is_deleted: true, unread_count: 0 },
      { where: { user_id: me, conversation_id: conversationId } }
    );
    ok(res, { conversation_id: conversationId });
  } catch (e) {
    console.error('deleteConversation error', e);
    fail(res, '删除会话失败', 500, 500);
  }
};

// POST /messages/send
exports.sendMessage = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    await ensureMessageTables();
    const senderId = uid(req);
    if (!senderId) {
      await t.rollback();
      return fail(res, '未登录', 401, 401);
    }

    const body = req.body || {};
    const content = String(body.content || '').trim();
    const msgType = String(body.msgType || body.msg_type || 'text');
    const { peerId: peerRaw, conversationId: reqConvId } = await resolvePeerForSend(senderId, body, t);
    const peerId = peerRaw && peerRaw !== '0' ? peerRaw : null;

    if (!content) {
      await t.rollback();
      return fail(res, '消息内容不能为空');
    }
    if (!peerId) {
      await t.rollback();
      return fail(res, '必须提供接收方 ID 或有效会话');
    }

    const preview = previewText(content, msgType);
    let conversationId = reqConvId > 0 ? reqConvId : 0;
    const channel = String(body.channel || body.bot_type || '').trim();
    const scope = orderScopeFromBody(body, channel);

    let senderUc = null;
    if (conversationId) {
      senderUc = await UserConversation.findOne({
        where: { user_id: senderId, conversation_id: conversationId },
        transaction: t
      });
    } else {
      const where = Object.assign({ user_id: senderId, peer_id: peerId }, scope);
      if (channel) where.bot_type = channel;
      senderUc = await UserConversation.findOne({ where, transaction: t });
      if (senderUc) conversationId = senderUc.conversation_id;
    }

    if (!conversationId) {
      const conv = await Conversation.create({ type: 'private', last_message_preview: preview }, { transaction: t });
      conversationId = conv.id;
      await UserConversation.create(
        Object.assign(
          {
            user_id: senderId,
            peer_id: peerId,
            conversation_id: conversationId,
            bot_type: channel || null,
            unread_count: 0,
            is_deleted: false
          },
          scope
        ),
        { transaction: t }
      );
      if (peerId !== senderId) {
        const reverseWhere = Object.assign({ user_id: peerId, peer_id: senderId }, scope);
        if (channel) reverseWhere.bot_type = channel;
        await UserConversation.findOrCreate({
          where: reverseWhere,
          defaults: Object.assign(
            { conversation_id: conversationId, unread_count: 0, is_deleted: false, bot_type: channel || null },
            scope
          ),
          transaction: t
        });
      }
    } else {
      await Conversation.update(
        { last_message_preview: preview, updated_at: new Date() },
        { where: { id: conversationId }, transaction: t }
      );
    }

    const msg = await Message.create(
      { conversation_id: conversationId, sender_id: senderId, msg_type: msgType, content },
      { transaction: t }
    );

    if (peerId !== senderId) {
      await UserConversation.increment('unread_count', {
        by: 1,
        where: { user_id: peerId, conversation_id: conversationId },
        transaction: t
      });
      await UserConversation.update(
        { is_deleted: false },
        { where: { user_id: peerId, conversation_id: conversationId }, transaction: t }
      );
    }
    await UserConversation.update(
      { is_deleted: false },
      { where: { user_id: senderId, conversation_id: conversationId }, transaction: t }
    );

    await t.commit();
    ok(res, msg);
  } catch (e) {
    await t.rollback();
    console.error('sendMessage error', e);
    fail(res, '消息发送失败', 500, 500);
  }
};

// POST /messages/upload
exports.uploadMedia = (req, res) => {
  try {
    if (!req.file) return fail(res, '未收到文件');
    const url = `/uploads/${req.file.filename}`;
    ok(res, { url, path: url });
  } catch (e) {
    console.error('uploadMedia error', e);
    fail(res, '上传失败', 500, 500);
  }
};

// POST /messages/order-conversation/ensure
exports.ensureOrderConversation = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    await ensureMessageTables();
    const me = uid(req);
    if (!me) {
      await t.rollback();
      return fail(res, '未登录', 401, 401);
    }

    const body = req.body || {};
    const channel = String(body.channel || 'shop_buyer');
    const orderNo = String(body.order_no || '').trim();
    const shopId = body.shop_id != null ? String(body.shop_id).trim() : '';
    let buyerUserId = resolveUserId(body.buyer_user_id || body.customer_user_id);
    let peerId = null;

    if (channel === 'shop_buyer') {
      if (!shopId) {
        await t.rollback();
        return fail(res, '缺少 shop_id');
      }
      if (!buyerUserId && orderNo) {
        if (MarketOrder) {
          const ord = await MarketOrder.findOne({
            where: { order_no: orderNo, shop_id: shopId },
            attributes: ['user_id'],
            transaction: t
          });
          if (ord && ord.user_id != null) buyerUserId = String(ord.user_id);
        } else {
          try {
            const [rows] = await sequelize.query(
              'SELECT user_id FROM market_orders WHERE order_no = :orderNo AND shop_id = :shopId LIMIT 1',
              { replacements: { orderNo, shopId }, transaction: t }
            );
            if (rows && rows[0] && rows[0].user_id != null) buyerUserId = String(rows[0].user_id);
          } catch (e) { /* ignore */ }
        }
      }
      if (!buyerUserId) buyerUserId = me;

      if (me === buyerUserId) {
        let shopOwnerId = null;
        try {
          const [shopRows] = await sequelize.query(
            'SELECT user_id FROM market_shops WHERE id = :shopId LIMIT 1',
            { replacements: { shopId }, transaction: t }
          );
          if (shopRows && shopRows[0] && shopRows[0].user_id != null) {
            shopOwnerId = String(shopRows[0].user_id);
          }
        } catch (e) { /* ignore */ }
        if (!shopOwnerId || shopOwnerId === buyerUserId) {
          await t.rollback();
          return fail(res, '未找到商家账号，暂无法发起会话');
        }
        peerId = shopOwnerId;
      } else {
        peerId = buyerUserId;
      }
    } else if (channel === 'shop_rider') {
      peerId = resolveUserId(body.rider_user_id);
    } else if (channel === 'merchant_customer') {
      peerId = resolveUserId(body.merchant_user_id);
    } else if (channel === 'worker_customer') {
      peerId = resolveUserId(body.worker_user_id);
    } else if (channel === 'neighbor_assist') {
      if (!NeighborAssistOrder) {
        await t.rollback();
        return fail(res, '邻里帮模块未加载', 503, 503);
      }
      const orderIdNum = Number(body.order_id || 0);
      if (!orderIdNum) {
        await t.rollback();
        return fail(res, '缺少 order_id');
      }
      const ordRow = await NeighborAssistOrder.findByPk(orderIdNum, { transaction: t });
      if (!ordRow) {
        await t.rollback();
        return fail(res, '订单不存在', 404, 404);
      }
      const publisherId = String(ordRow.user_id);
      const helperId = ordRow.assigned_worker_id != null ? String(ordRow.assigned_worker_id) : null;
      if (!helperId) {
        await t.rollback();
        return fail(res, '订单尚未指派邻居，暂时无法会话', 400, 400);
      }
      if (me !== publisherId && me !== helperId) {
        await t.rollback();
        return fail(res, '无权参与该会话', 403, 403);
      }
      peerId = me === publisherId ? helperId : publisherId;
    }

    if (!peerId || peerId === '0') {
      await t.rollback();
      return fail(res, '缺少会话对端');
    }

    let orderIdForScope = body.order_id != null ? Number(body.order_id) : 0;
    const preview = orderNo ? `订单沟通 ${orderNo}` : '订单沟通';
    const conversationId = await ensureUserOrderMapping({
      me,
      peerId,
      channel,
      orderId: orderIdForScope > 0 ? orderIdForScope : null,
      orderNo: orderNo || (orderIdForScope > 0 ? String(orderIdForScope) : ''),
      preview,
      transaction: t
    });

    await t.commit();
    ok(res, {
      conversation_id: conversationId,
      channel,
      order_no: orderNo || (orderIdForScope > 0 ? String(orderIdForScope) : ''),
      order_id: orderIdForScope > 0 ? orderIdForScope : null,
      peer_id: peerId
    });
  } catch (e) {
    await t.rollback();
    console.error('ensureOrderConversation error', e);
    fail(res, '建立会话失败', 500, 500);
  }
};

exports.ensureNeighborAssistConversation = async (orderId) => {
  await ensureMessageTables();
  const orderIdNum = Number(orderId);
  if (!orderIdNum || !NeighborAssistOrder) return null;
  const ordRow = await NeighborAssistOrder.findByPk(orderIdNum);
  if (!ordRow || ordRow.assigned_worker_id == null) return null;
  const publisherId = String(ordRow.user_id);
  const helperId = String(ordRow.assigned_worker_id);
  const orderNo = String(orderIdNum);
  const preview = `订单沟通 ${orderNo}`;
  const t = await sequelize.transaction();
  try {
    let convId = null;
    for (const me of [publisherId, helperId]) {
      const peerId = me === publisherId ? helperId : publisherId;
      convId = await ensureUserOrderMapping({
        me,
        peerId,
        channel: 'neighbor_assist',
        orderId: orderIdNum,
        orderNo,
        preview,
        transaction: t
      });
    }
    await t.commit();
    return convId;
  } catch (e) {
    await t.rollback();
    console.error('ensureNeighborAssistConversation error', e);
    return null;
  }
};

exports.seedNeighborAssistCheckInMessage = async (orderId, helperUserId) => {
  const convId = await exports.ensureNeighborAssistConversation(orderId);
  if (!convId || !NeighborAssistOrder) return null;
  const ordRow = await NeighborAssistOrder.findByPk(Number(orderId));
  if (!ordRow) return null;
  const publisherId = String(ordRow.user_id);
  const now = new Date();
  const timeStr = `${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const content = `【系统消息】接单邻居已于 ${timeStr} 到场打卡，开始为您提供服务。`;
  const preview = previewText(content, 'text');
  const t = await sequelize.transaction();
  try {
    await Message.create(
      { conversation_id: convId, sender_id: 0, msg_type: 'text', content },
      { transaction: t }
    );
    await Conversation.update(
      { last_message_preview: preview, updated_at: new Date() },
      { where: { id: convId }, transaction: t }
    );
    if (helperUserId && String(helperUserId) !== publisherId) {
      await UserConversation.increment('unread_count', {
        by: 1,
        where: { user_id: publisherId, conversation_id: convId },
        transaction: t
      });
    }
    await UserConversation.update(
      { is_deleted: false },
      { where: { conversation_id: convId }, transaction: t }
    );
    await t.commit();
    return convId;
  } catch (e) {
    await t.rollback();
    console.error('seedNeighborAssistCheckInMessage error', e);
    return null;
  }
};

exports.seedNeighborAssistGrabMessage = async (orderId, grabberUserId) => {
  const convId = await exports.ensureNeighborAssistConversation(orderId);
  if (!convId || !NeighborAssistOrder) return null;
  const ordRow = await NeighborAssistOrder.findByPk(Number(orderId));
  if (!ordRow) return null;
  const publisherId = String(ordRow.user_id);
  const content = '对方已接单，可以开始沟通了';
  const preview = previewText(content, 'text');
  const t = await sequelize.transaction();
  try {
    await Message.create(
      { conversation_id: convId, sender_id: 0, msg_type: 'text', content },
      { transaction: t }
    );
    await Conversation.update(
      { last_message_preview: preview, updated_at: new Date() },
      { where: { id: convId }, transaction: t }
    );
    if (grabberUserId && String(grabberUserId) !== publisherId) {
      await UserConversation.increment('unread_count', {
        by: 1,
        where: { user_id: publisherId, conversation_id: convId },
        transaction: t
      });
    }
    await UserConversation.update(
      { is_deleted: false },
      { where: { conversation_id: convId }, transaction: t }
    );
    await t.commit();
    return convId;
  } catch (e) {
    await t.rollback();
    console.error('seedNeighborAssistGrabMessage error', e);
    return null;
  }
};

// POST /messages/broadcast — 系统通知推送给全体用户
exports.broadcast = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    await ensureMessageTables();
    const botType = String((req.body && req.body.botType) || 'notices');
    const content = String((req.body && req.body.content) || '').trim();
    const msgType = String((req.body && req.body.msgType) || 'text');
    if (!content) return fail(res, '缺少 content');
    if (!SYSTEM_BOT_TYPES.includes(botType)) return fail(res, '无效 botType');

    const conv = await Conversation.create(
      { type: 'system', last_message_preview: previewText(content, msgType) },
      { transaction: t }
    );

    await Message.create(
      { conversation_id: conv.id, sender_id: 0, msg_type: msgType, content },
      { transaction: t }
    );

    const users = await User.findAll({ attributes: ['id'], transaction: t });
    for (const user of users) {
      const userId = String(user.id);
      const [uc] = await UserConversation.findOrCreate({
        where: { user_id: userId, peer_id: 0, bot_type: botType },
        defaults: { conversation_id: conv.id, unread_count: 0, is_deleted: false },
        transaction: t
      });
      await uc.update({ conversation_id: conv.id, is_deleted: false }, { transaction: t });
      await UserConversation.increment('unread_count', {
        by: 1,
        where: { id: uc.id },
        transaction: t
      });
    }

    await t.commit();
    ok(res, { accepted: true, conversation_id: conv.id, sent_users: users.length });
  } catch (e) {
    await t.rollback();
    console.error('broadcast error', e);
    fail(res, '广播失败', 500, 500);
  }
};

// 供订单状态变更等业务调用
exports.notifyUser = async ({ userId, botType = 'logistics', content, msgType = 'text' }) => {
  await ensureMessageTables();
  const uid = resolveUserId(userId);
  if (!uid || !content) return null;

  const preview = previewText(content, msgType);
  const t = await sequelize.transaction();
  try {
    let uc = await UserConversation.findOne({
      where: { user_id: uid, peer_id: 0, bot_type: botType },
      transaction: t
    });
    let conversationId = uc && uc.conversation_id;
    if (!conversationId) {
      const conv = await Conversation.create({ type: 'system', last_message_preview: preview }, { transaction: t });
      conversationId = conv.id;
      await UserConversation.create(
        { user_id: uid, peer_id: 0, conversation_id: conversationId, bot_type: botType, unread_count: 1, is_deleted: false },
        { transaction: t }
      );
    } else {
      await Conversation.update(
        { last_message_preview: preview, updated_at: new Date() },
        { where: { id: conversationId }, transaction: t }
      );
      await UserConversation.increment('unread_count', { by: 1, where: { id: uc.id }, transaction: t });
      await UserConversation.update({ is_deleted: false }, { where: { id: uc.id }, transaction: t });
    }
    const msg = await Message.create(
      { conversation_id: conversationId, sender_id: 0, msg_type: msgType, content },
      { transaction: t }
    );
    await t.commit();
    return msg;
  } catch (e) {
    await t.rollback();
    console.error('notifyUser error', e);
    return null;
  }
};

exports.deleteConversationList = exports.deleteConversation;
