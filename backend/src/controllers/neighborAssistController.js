const { Op } = require('sequelize');
const { NeighborAssistOrder, User, WorkerApplication, WorkerProfile } = require('../models');
const { resolveUserIdFromReq } = require('../utils/resolveUserId');
const { parseNeighborAppointmentTime } = require('../utils/parseNeighborAppointmentTime');
const commissionService = require('../modules/commission/services/commission.service');
const platformFeeService = require('../services/platformFee.service');
const couponService = require('../modules/coupon/services/coupon.service');

const ok = (res, data) => res.json({ errno: 0, data });
const fail = (res, errno, errmsg, http = 200) => res.status(http).json({ errno, errmsg });

const ASSIST_TYPES = new Set(['take', 'child', 'escort', 'trash', 'pet', 'read', 'errand', 'other', '代取', '接送小孩', '陪诊', '陪读', '代扔垃圾', '宠物喂养', '跑腿', '其他']);

const ASSIST_TYPE_LABELS = {
  take: '代取快递',
  child: '接送小孩',
  escort: '陪诊陪护',
  trash: '代扔垃圾',
  pet: '宠物喂养',
  read: '陪读',
  errand: '跑腿',
  other: '其他',
  '代取': '代取快递',
  '接送小孩': '接送小孩',
  '陪诊': '陪诊陪护',
  '陪读': '陪读',
  '代扔垃圾': '代扔垃圾',
  '宠物喂养': '宠物喂养',
  '跑腿': '跑腿',
  '其他': '其他'
};

const NEIGHBOR_ORDER_STATUS_TEXT = {
  pending_pay: '待支付',
  paid_pending_dispatch: '待接单',
  dispatched: '已接单',
  in_service: '服务中',
  pending_confirm: '待确认',
  completed: '已完成',
  cancelled: '已取消',
  closed: '已关闭'
};

function normalizeProofImages(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? (() => {
    try { return JSON.parse(raw); } catch (e) { return []; }
  })() : []);
  return arr
    .map((u) => (u != null ? String(u).trim() : ''))
    .filter((u) => u && (u.startsWith('http') || u.startsWith('/')));
}

function parseProofImagesField(row) {
  const v = row && row.completion_proof_images;
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

async function assertWorker(userId) {
  const app = await WorkerApplication.findOne({ where: { user_id: userId, status: 'approved' } });
  const prof = await WorkerProfile.findOne({ where: { user_id: userId, status: 'active' } });
  return !!(app && prof);
}

async function assertWorkerCanTakeOrder(workerUserId, order) {
  if (!(await assertWorker(workerUserId))) return { ok: false, reason: '非已入驻技工' };
  if (order.user_id === workerUserId) return { ok: false, reason: '不能接自己发布的订单' };
  const prof = await WorkerProfile.findOne({ where: { user_id: workerUserId, status: 'active' } });
  const oc = order.community_id != null ? Number(order.community_id) : null;
  const wc = prof && prof.community_id != null ? Number(prof.community_id) : null;
  if (oc != null && wc != null && oc !== wc) return { ok: false, reason: '非本小区订单' };
  return { ok: true };
}

function normalizeAssistType(raw) {
  const t = String(raw || '').trim();
  if (!t || t.length > 32) return null;
  if (ASSIST_TYPES.has(t)) return t;
  return t;
}

function mapNeighborOrderFields(plain, viewerUserId) {
  const fee = platformFeeService.displayAmountForRole(
    { ...plain, amount: plain.amount, payable_amount: plain.amount },
    viewerUserId,
    'neighbor_assist'
  );
  return {
    payable_amount: fee.payable_amount,
    settlement_amount: fee.settlement_amount,
    platform_fee_amount: fee.platform_fee_amount,
    platform_fee_rate: fee.platform_fee_rate,
    amount: fee.amount,
    reward_amount: fee.reward_amount,
    display_amount: fee.display_amount
  };
}

// Create order with amount
exports.create = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, 401, '未登录');
    const {
      assist_type,
      origin_address_snapshot,
      destination_address_snapshot,
      community_id,
      appointment_time,
      remark,
      amount,
      reward_amount,
      content,
      contact_phone
    } = req.body;

    const assistType = normalizeAssistType(assist_type);
    if (!assistType) return fail(res, 400, '请选择或填写服务类型');

    const origin = origin_address_snapshot && typeof origin_address_snapshot === 'object'
      ? origin_address_snapshot
      : { address: '', detail: '' };
    const dest = destination_address_snapshot && typeof destination_address_snapshot === 'object'
      ? destination_address_snapshot
      : { address: '', detail: '' };

    let commId = community_id != null ? parseInt(community_id, 10) : null;
    if (!commId) {
      const u = await User.findByPk(userId, { attributes: ['community_id'] });
      commId = u && u.community_id != null ? Number(u.community_id) : null;
    }
    if (!commId || !Number.isFinite(commId) || commId <= 0) {
      return fail(res, 400, '请先在「我的」绑定小区后再发布');
    }

    const orderAmount = (reward_amount != null ? reward_amount : amount) != null
      ? String(reward_amount != null ? reward_amount : amount) : null;
    const phone = contact_phone != null ? String(contact_phone).trim() : '';
    const bodyContent = content != null ? String(content).trim() : '';
    let finalRemark = remark != null ? String(remark).trim() : '';
    if (bodyContent && !finalRemark.includes(bodyContent)) {
      finalRemark = finalRemark ? `${bodyContent}\n${finalRemark}` : bodyContent;
    }
    if (phone) {
      finalRemark = finalRemark ? `${finalRemark}\n联系电话：${phone}` : `联系电话：${phone}`;
    }

    const appt = parseNeighborAppointmentTime(appointment_time);

    if (!NeighborAssistOrder) return fail(res, 500, 'NeighborAssistOrder 模型未加载');

    const goodsAmountBeforeCoupon = orderAmount != null ? Number(orderAmount) : 0;
    let couponDiscount = 0;
    let couponIssueId = Number(req.body.coupon_issue_id || req.body.couponIssueId || 0) || 0;
    let payableNum = goodsAmountBeforeCoupon;
    if (couponIssueId > 0 && payableNum > 0) {
      try {
        const applied = await couponService.validateCouponForOrder(
          userId, couponIssueId, goodsAmountBeforeCoupon, null, 'neighbor_assist'
        );
        couponDiscount = applied.discount;
        payableNum = applied.payableAmount;
      } catch (couponErr) {
        return fail(res, couponErr.statusCode || 400, couponErr.message || '优惠券不可用');
      }
    }

    const feeFields = payableNum > 0
      ? await platformFeeService.calcPlatformFee(payableNum, 'neighbor_assist')
      : {
        platform_fee_rate: 0,
        platform_fee_amount: 0,
        settlement_amount: 0,
        payable_amount: 0
      };

    const row = await NeighborAssistOrder.create({
      assist_type: assistType,
      user_id: userId,
      community_id: commId,
      origin_address_snapshot: origin,
      destination_address_snapshot: dest,
      amount: payableNum > 0 ? payableNum : null,
      platform_fee_rate: feeFields.platform_fee_rate,
      platform_fee_amount: feeFields.platform_fee_amount,
      settlement_amount: feeFields.settlement_amount,
      appointment_time: appt,
      content: bodyContent || finalRemark || null,
      remark: finalRemark || bodyContent || null,
      contact_phone: phone || null,
      status: 'pending_pay',
      pay_status: 'unpaid'
    });
    if (couponIssueId > 0) {
      await couponService.markCouponUsed(couponIssueId, 'neighbor_assist', String(row.id));
    }
    return ok(res, {
      id: row.id,
      order_id: row.id,
      status: row.status,
      assist_type: row.assist_type,
      assist_type_label: ASSIST_TYPE_LABELS[row.assist_type] || row.assist_type,
      amount: String(payableNum > 0 ? payableNum : ''),
      reward_amount: String(payableNum > 0 ? payableNum : ''),
      discount_amount: couponDiscount.toFixed(2),
      goods_amount_before_coupon: goodsAmountBeforeCoupon > 0 ? goodsAmountBeforeCoupon.toFixed(2) : '0.00',
      settlement_amount: feeFields.settlement_amount,
      platform_fee_amount: feeFields.platform_fee_amount,
      platform_fee_rate: feeFields.platform_fee_rate
    });
  } catch (e) {
    console.error('neighborAssist create', e);
    const hint = e && e.parent && e.parent.sqlMessage ? e.parent.sqlMessage : (e && e.message);
    return fail(res, 500, hint && String(hint).length < 120 ? `创建失败：${hint}` : '创建失败');
  }
};

// My orders (publisher or helper role)
exports.myList = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, 401, '未登录');
    const role = req.query.role || 'publisher';
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    let limit = parseInt(req.query.limit != null && req.query.limit !== '' ? req.query.limit : req.query.page_size || '10', 10) || 10;
    limit = Math.min(Math.max(limit, 1), 50);
    const offset = (page - 1) * limit;

    const where = {};
    if (role === 'publisher') {
      where.user_id = userId;
    } else if (role === 'helper') {
      where.assigned_worker_id = userId;
    } else {
      where[Op.or] = [{ user_id: userId }, { assigned_worker_id: userId }];
    }

    const { rows, count } = await NeighborAssistOrder.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone', 'avatar_url'], required: false },
        { model: User, as: 'assignedWorker', attributes: ['id', 'nickname', 'phone', 'avatar_url'], required: false }
      ]
    });
    const list = rows.map((row) => {
      const plain = row.get({ plain: true });
      const pub = plain.buyer;
      const worker = plain.assignedWorker;
      const amt = plain.amount != null ? String(plain.amount) : '';
      const feeView = mapNeighborOrderFields(plain, userId);
      return {
        id: plain.id,
        assist_type: plain.assist_type,
        assist_type_label: ASSIST_TYPE_LABELS[plain.assist_type] || plain.assist_type,
        status: plain.status,
        status_text: NEIGHBOR_ORDER_STATUS_TEXT[plain.status] || plain.status,
        pay_status: plain.pay_status,
        amount: feeView.amount,
        reward_amount: feeView.reward_amount,
        payable_amount: feeView.payable_amount,
        settlement_amount: feeView.settlement_amount,
        created_at: plain.created_at,
        appointment_time: plain.appointment_time,
        community_id: plain.community_id,
        origin_address_snapshot: plain.origin_address_snapshot,
        destination_address_snapshot: plain.destination_address_snapshot,
        content: plain.content || plain.remark,
        remark: plain.remark,
        publisher: pub ? { id: pub.id, nickname: pub.nickname, phone: pub.phone, avatar_url: pub.avatar_url } : null,
        helper: worker ? { id: worker.id, nickname: worker.nickname, phone: worker.phone, avatar_url: worker.avatar_url } : null,
        assigned_worker: worker
          ? { id: worker.id, nickname: worker.nickname, name: worker.nickname || '', avatar_url: worker.avatar_url || '' }
          : null,
        my_role: role
      };
    });
    return ok(res, { list, total: count, page, limit });
  } catch (e) {
    console.error('neighborAssist myList', e);
    return fail(res, 500, '查询失败');
  }
};

// Mock pay (publisher pays for their order)
exports.mockPay = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');
    const order = await NeighborAssistOrder.findOne({ where: { id, user_id: userId } });
    if (!order) return fail(res, 404, '订单不存在');
    if (order.pay_status === 'paid') return fail(res, 400, '已支付');
    order.pay_status = 'paid';
    order.status = 'paid_pending_dispatch';
    await order.save();
    try {
      const payAmount = Number(order.amount || 0);
      let pool = Number(order.platform_fee_amount || 0);
      if (payAmount > 0 && pool <= 0) {
        pool = Number((payAmount * 0.10).toFixed(2));
      }
      if (payAmount > 0 && pool > 0) {
        await commissionService.distributeCommission(
          String(order.id),
          'neighbor_assist',
          payAmount,
          order.user_id || userId,
          pool
        );
      }
    } catch (ce) {
      console.warn('[neighborAssist/commission]', ce.message);
    }
    return ok(res, order.get({ plain: true }));
  } catch (e) {
    console.error('neighborAssist mockPay', e);
    return fail(res, 500, '支付失败');
  }
};

// Worker pool (技工抢单大厅 - existing, requires worker)
exports.pool = async (req, res) => {
  try {
    const workerId = resolveUserIdFromReq(req);
    if (!workerId) return fail(res, 401, '未登录');
    if (!(await assertWorker(workerId))) return fail(res, 403, '非已入驻技工', 403);
    const prof = await WorkerProfile.findOne({ where: { user_id: workerId, status: 'active' } });
    let filterComm = prof && prof.community_id != null ? Number(prof.community_id) : null;
    if (req.query.community_id != null && req.query.community_id !== '') {
      const q = parseInt(req.query.community_id, 10);
      if (Number.isFinite(q)) {
        if (filterComm != null && q !== filterComm) return fail(res, 400, 'community_id 与本人接单小区不一致');
        filterComm = q;
      }
    }
    const where = {
      status: 'paid_pending_dispatch',
      pay_status: 'paid',
      assigned_worker_id: null,
      user_id: { [Op.ne]: workerId }
    };
    if (filterComm != null) where.community_id = filterComm;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    let limit = parseInt(req.query.limit, 10) || 20;
    limit = Math.min(Math.max(limit, 1), 50);
    const offset = (page - 1) * limit;

    const { rows, count } = await NeighborAssistOrder.findAndCountAll({
      where,
      order: [['created_at', 'ASC']],
      limit,
      offset,
      include: [{ model: User, as: 'buyer', attributes: ['id', 'nickname', 'avatar_url', 'phone'] }]
    });
    const list = rows.map((row) => {
      const plain = row.get({ plain: true });
      const b = plain.buyer;
      return {
        id: plain.id,
        assist_type: plain.assist_type,
        assist_type_label: ASSIST_TYPE_LABELS[plain.assist_type] || plain.assist_type,
        status: plain.status,
        amount: plain.amount != null ? String(plain.amount) : '',
        community_id: plain.community_id,
        created_at: plain.created_at,
        appointment_time: plain.appointment_time,
        origin_address_snapshot: plain.origin_address_snapshot,
        destination_address_snapshot: plain.destination_address_snapshot,
        content: plain.content || plain.remark,
        remark: plain.remark,
        buyer: b ? { id: b.id, nickname: b.nickname || '', avatar_url: b.avatar_url || '' } : null
      };
    });
    return ok(res, { list, total: count, page, limit });
  } catch (e) {
    console.error('neighborAssist pool', e);
    return fail(res, 500, '查询失败');
  }
};

// Community pool - 同社区未接单的待支付订单（面向社区普通成员，非技工）
exports.communityPool = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, 401, '未登录');
    const user = await User.findByPk(userId, { attributes: ['id', 'nickname', 'avatar_url', 'phone', 'community_id'] });
    if (!user) return fail(res, 404, '用户不存在');

    const myComm = user.community_id != null ? Number(user.community_id) : null;
    const where = {
      status: 'paid_pending_dispatch',
      pay_status: 'paid',
      user_id: { [Op.ne]: userId },
      assigned_worker_id: null
    };
    if (myComm != null) where.community_id = myComm;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    let limit = parseInt(req.query.limit, 10) || 20;
    limit = Math.min(Math.max(limit, 1), 50);
    const offset = (page - 1) * limit;

    const { rows, count } = await NeighborAssistOrder.findAndCountAll({
      where,
      order: [['created_at', 'ASC']],
      limit,
      offset,
      include: [{ model: User, as: 'buyer', attributes: ['id', 'nickname', 'avatar_url'] }]
    });
    const list = rows.map((row) => {
      const plain = row.get({ plain: true });
      const b = plain.buyer;
      const feeView = mapNeighborOrderFields(plain, userId);
      return {
        id: plain.id,
        assist_type: plain.assist_type,
        assist_type_label: ASSIST_TYPE_LABELS[plain.assist_type] || plain.assist_type,
        status: plain.status,
        amount: feeView.amount,
        reward_amount: feeView.reward_amount,
        settlement_amount: feeView.settlement_amount,
        community_id: plain.community_id,
        created_at: plain.created_at,
        appointment_time: plain.appointment_time,
        origin_address_snapshot: plain.origin_address_snapshot,
        destination_address_snapshot: plain.destination_address_snapshot,
        content: plain.content || plain.remark,
        remark: plain.remark,
        publisher: b ? { id: b.id, nickname: b.nickname || '', avatar_url: b.avatar_url || '' } : null
      };
    });
    return ok(res, { list, total: count, page, limit });
  } catch (e) {
    console.error('neighborAssist communityPool', e);
    return fail(res, 500, '查询失败');
  }
};

// Worker grab (技工抢单 - existing, requires worker)
exports.grab = async (req, res) => {
  try {
    const workerId = resolveUserIdFromReq(req);
    if (!workerId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');
    const order = await NeighborAssistOrder.findByPk(id);
    if (!order) return fail(res, 404, '订单不存在', 404);
    const chk = await assertWorkerCanTakeOrder(workerId, order);
    if (!chk.ok) return fail(res, 400, chk.reason);
    if (order.status !== 'paid_pending_dispatch' || order.assigned_worker_id != null) {
      return fail(res, 400, '当前订单不可抢，可能已被指派或状态已变');
    }
    if (order.pay_status !== 'paid') return fail(res, 400, '订单未支付');

    const [n] = await NeighborAssistOrder.update(
      { assigned_worker_id: workerId, dispatch_at: new Date(), dispatch_by: null, status: 'dispatched' },
      { where: { id, status: 'paid_pending_dispatch', assigned_worker_id: null, pay_status: 'paid' } }
    );
    if (!n) return fail(res, 400, '抢单失败：订单已被其他人抢走');

    const fresh = await NeighborAssistOrder.findByPk(id, {
      include: [{ model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone'] }]
    });
    try {
      const messageCtrl = require('../modules/message/controllers/message.controller');
      await messageCtrl.seedNeighborAssistGrabMessage(id, workerId);
    } catch (chatErr) {
      console.warn('neighborAssist grab chat seed', chatErr.message);
    }
    return ok(res, { id: fresh.id, status: fresh.status, status_text: NEIGHBOR_ORDER_STATUS_TEXT[fresh.status] || fresh.status, assigned_worker_id: fresh.assigned_worker_id, grab: true });
  } catch (e) {
    console.error('neighborAssist grab', e);
    return fail(res, 500, '操作失败', 500);
  }
};

// Community grab - 社区普通成员接单（非技工，面向邻里互助）
exports.communityGrab = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');

    const order = await NeighborAssistOrder.findByPk(id);
    if (!order) return fail(res, 404, '订单不存在', 404);
    if (order.user_id === userId) return fail(res, 400, '不能接自己发布的订单');

    // 同社区检查
    const user = await User.findByPk(userId, { attributes: ['community_id'] });
    const oc = order.community_id != null ? Number(order.community_id) : null;
    const uc = user && user.community_id != null ? Number(user.community_id) : null;
    if (oc != null && uc != null && oc !== uc) return fail(res, 400, '非本小区订单');

    const [n] = await NeighborAssistOrder.update(
      { assigned_worker_id: userId, dispatch_at: new Date(), dispatch_by: null, status: 'dispatched' },
      { where: { id, status: 'paid_pending_dispatch', assigned_worker_id: null, pay_status: 'paid' } }
    );
    if (!n) return fail(res, 400, '接单失败：订单已被其他人接走');

    const fresh = await NeighborAssistOrder.findByPk(id, {
      include: [{ model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone'] }]
    });
    try {
      const messageCtrl = require('../modules/message/controllers/message.controller');
      await messageCtrl.seedNeighborAssistGrabMessage(id, userId);
    } catch (chatErr) {
      console.warn('neighborAssist communityGrab chat seed', chatErr.message);
    }
    return ok(res, { id: fresh.id, status: fresh.status, status_text: NEIGHBOR_ORDER_STATUS_TEXT[fresh.status] || fresh.status, assigned_worker_id: fresh.assigned_worker_id, grab: true });
  } catch (e) {
    console.error('neighborAssist communityGrab', e);
    return fail(res, 500, '操作失败', 500);
  }
};

// POST /neighbor-assist/orders/:id/check-in — 接单方上门定位打卡
exports.checkIn = async (req, res) => {
  try {
    const helperId = resolveUserIdFromReq(req);
    if (!helperId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');
    const body = req.body || {};
    const latitude = body.latitude != null ? Number(body.latitude) : null;
    const longitude = body.longitude != null ? Number(body.longitude) : null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return fail(res, 400, '缺少有效 latitude / longitude');
    }

    const order = await NeighborAssistOrder.findByPk(id);
    if (!order) return fail(res, 404, '订单不存在', 404);
    if (order.assigned_worker_id !== helperId) return fail(res, 403, '无权限操作该订单', 403);
    if (order.pay_status !== 'paid') return fail(res, 400, '订单未支付');
    if (!['dispatched', 'in_service'].includes(String(order.status))) {
      return fail(res, 400, '当前状态不可打卡');
    }

    const checkInAt = order.check_in_at || new Date();
    await order.update({
      status: 'in_service',
      check_in_at: checkInAt,
      check_in_lat: latitude,
      check_in_lng: longitude
    });

    try {
      const messageCtrl = require('../modules/message/controllers/message.controller');
      if (messageCtrl.seedNeighborAssistCheckInMessage) {
        await messageCtrl.seedNeighborAssistCheckInMessage(id, helperId);
      }
    } catch (chatErr) {
      console.warn('neighborAssist checkIn chat seed', chatErr.message);
    }

    return ok(res, {
      id: order.id,
      status: 'in_service',
      status_text: NEIGHBOR_ORDER_STATUS_TEXT.in_service,
      check_in_at: checkInAt,
      check_in_lat: latitude,
      check_in_lng: longitude
    });
  } catch (e) {
    console.error('neighborAssist checkIn', e);
    return fail(res, 500, '打卡失败');
  }
};

// Accept (接单方确认开始服务)
exports.accept = async (req, res) => {
  try {
    const workerId = resolveUserIdFromReq(req);
    if (!workerId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');
    const order = await NeighborAssistOrder.findByPk(id);
    if (!order) return fail(res, 404, '订单不存在', 404);
    if (order.assigned_worker_id !== workerId) return fail(res, 403, '无权限操作该订单', 403);
    if (order.pay_status !== 'paid') return fail(res, 400, '订单未支付');
    if (order.status !== 'dispatched') return fail(res, 400, '当前状态不可接单');
    order.status = 'in_service';
    await order.save();
    return ok(res, { id: order.id, status: order.status, status_text: NEIGHBOR_ORDER_STATUS_TEXT[order.status] || order.status });
  } catch (e) {
    console.error('neighborAssist accept', e);
    return fail(res, 500, '操作失败', 500);
  }
};

// Complete - 接单方提交服务完成（含凭证照片），待发布人确认后结算
exports.complete = async (req, res) => {
  try {
    const workerId = resolveUserIdFromReq(req);
    if (!workerId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');
    const body = req.body || {};
    const proofImages = normalizeProofImages(body.proof_images || body.completion_proof_images);
    if (!proofImages.length) {
      return fail(res, 400, '请上传至少 1 张服务完成凭证照片');
    }
    const order = await NeighborAssistOrder.findByPk(id);
    if (!order) return fail(res, 404, '订单不存在', 404);
    if (order.assigned_worker_id !== workerId) return fail(res, 403, '无权限操作该订单', 403);
    if (order.status !== 'in_service') return fail(res, 400, '当前状态不可完成');
    if (!order.check_in_at) return fail(res, 400, '请先完成上门打卡');

    order.completion_proof_images = proofImages;
    order.status = 'pending_confirm';
    order.completed_at = new Date();
    await order.save();

    return ok(res, {
      id: order.id,
      status: order.status,
      status_text: NEIGHBOR_ORDER_STATUS_TEXT[order.status] || order.status,
      completion_proof_images: proofImages,
      completed_at: order.completed_at
    });
  } catch (e) {
    console.error('neighborAssist complete', e);
    return fail(res, 500, '操作失败');
  }
};

// Publisher cancel (unpaid orders)
exports.cancel = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');
    const order = await NeighborAssistOrder.findOne({ where: { id, user_id: userId } });
    if (!order) return fail(res, 404, '订单不存在', 404);
    if (order.pay_status !== 'unpaid' || order.status !== 'pending_pay') {
      return fail(res, 400, '当前状态不可取消');
    }
    order.status = 'cancelled';
    await order.save();
    return ok(res, { id: order.id, status: order.status, status_text: NEIGHBOR_ORDER_STATUS_TEXT[order.status] || order.status });
  } catch (e) {
    console.error('neighborAssist cancel', e);
    return fail(res, 500, '操作失败');
  }
};

// Reject (接单方拒单，订单回到待接单池)
exports.reject = async (req, res) => {
  try {
    const workerId = resolveUserIdFromReq(req);
    if (!workerId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');
    const order = await NeighborAssistOrder.findByPk(id);
    if (!order) return fail(res, 404, '订单不存在', 404);
    if (order.assigned_worker_id !== workerId) return fail(res, 403, '无权限操作该订单', 403);
    if (order.status !== 'dispatched' && order.status !== 'in_service') return fail(res, 400, '当前状态不可拒单');
    order.status = 'paid_pending_dispatch';
    order.assigned_worker_id = null;
    order.dispatch_at = null;
    order.dispatch_by = null;
    await order.save();
    return ok(res, { id: order.id, status: order.status, status_text: NEIGHBOR_ORDER_STATUS_TEXT[order.status] || order.status });
  } catch (e) {
    console.error('neighborAssist reject', e);
    return fail(res, 500, '操作失败');
  }
};

// Detail
exports.detail = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, 401, '未登录');
    const orderId = parseInt(req.params.id, 10);
    if (!Number.isFinite(orderId)) return fail(res, 400, '无效订单ID');

    const order = await NeighborAssistOrder.findOne({
      where: { id: orderId },
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone', 'avatar_url'], required: false },
        { model: User, as: 'assignedWorker', attributes: ['id', 'nickname', 'phone', 'avatar_url'], required: false }
      ]
    });
    if (!order) return fail(res, 404, '订单不存在');

    // 权限：发布人、接单人可看完整详情；其他人仅在池子中有查看摘要的权限
    const plain = order.get({ plain: true });
    const pub = plain.buyer;
    const worker = plain.assignedWorker;
    const isPublisher = order.user_id === userId;
    const isHelper = order.assigned_worker_id === userId;

    const myRole = isPublisher ? 'publisher' : isHelper ? 'helper' : '';

    const completionProofImages = parseProofImagesField(plain);

    const resp = {
      ...plain,
      assist_type_label: ASSIST_TYPE_LABELS[plain.assist_type] || plain.assist_type,
      status_text: NEIGHBOR_ORDER_STATUS_TEXT[plain.status] || plain.status,
      ...mapNeighborOrderFields(plain, userId),
      completion_proof_images: completionProofImages,
      publisher: pub ? { id: pub.id, nickname: pub.nickname, phone: pub.phone, avatar_url: pub.avatar_url } : null,
      helper: worker ? { id: worker.id, nickname: worker.nickname, phone: worker.phone, avatar_url: worker.avatar_url } : null,
      my_role: myRole
    };

    // 手机脱敏
    if (myRole === 'publisher' && worker) {
      const isAccepted = ['dispatched', 'in_service', 'pending_confirm', 'completed'].includes(order.status);
      resp.helper = { ...resp.helper, phone: isAccepted ? worker.phone : (worker.phone ? worker.phone.substring(0, 3) + '****' + worker.phone.substring(7) : '') };
    }

    return ok(res, { order: resp });
  } catch (e) {
    console.error('neighborAssist detail', e);
    return fail(res, 500, '查询失败');
  }
};

// Confirm (发布人确认订单完成，结算给接单方)
exports.confirm = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return fail(res, 401, '未登录');
    const id = parseInt(req.params.id, 10);
    if (!id) return fail(res, 400, '无效订单 id');
    const order = await NeighborAssistOrder.findOne({ where: { id, user_id: userId } });
    if (!order) return fail(res, 404, '订单不存在');
    if (order.status === 'completed') {
      return ok(res, { id: order.id, status: order.status, confirmed: true, status_text: NEIGHBOR_ORDER_STATUS_TEXT[order.status] || order.status });
    }
    if (order.status !== 'pending_confirm') return fail(res, 400, '当前状态不可确认');

    order.status = 'completed';
    if (!order.completed_at) order.completed_at = new Date();
    await order.save();

    const orderSettlement = require('../services/orderSettlement.service');
    const settleNum = orderSettlement.calcSettlementAmount(order);
    try {
      await orderSettlement.settleOrderComplete({
        orderId: order.id,
        orderType: 'neighbor_assist',
        earnerUserId: order.assigned_worker_id,
        earnerRole: 'neighbor_assist',
        settlementAmount: settleNum
      });
    } catch (se) {
      console.warn('[neighborAssist/confirm/settlement]', se.message);
    }

    return ok(res, {
      id: order.id,
      status: order.status,
      confirmed: true,
      status_text: NEIGHBOR_ORDER_STATUS_TEXT[order.status] || order.status,
      amount_transferred: settleNum
    });
  } catch (e) {
    console.error('neighborAssist confirm', e);
    return fail(res, 500, '操作失败');
  }
};
