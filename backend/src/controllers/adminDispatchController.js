const { Op } = require('sequelize');
const { ServiceOrder, NeighborAssistOrder, Service, User, WorkerApplication, WorkerProfile } = require('../models');

const ok = (res, data) => res.json({ errno: 0, data });
const fail = (res, errno, errmsg, http = 200) => res.status(http).json({ errno, errmsg });

function parseCommunityId(q) {
  if (q === undefined || q === null || q === '') return null;
  const c = parseInt(String(q), 10);
  return Number.isFinite(c) ? c : null;
}

/** 技工用户 ID（雪花 BIGINT，禁止 parseInt） */
function parseWorkerUserId(body) {
  const raw =
    body && body.worker_id != null && body.worker_id !== ''
      ? body.worker_id
      : body && body.worker_user_id;
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  return /^\d+$/.test(s) ? s : null;
}

async function workerAssignable(workerId) {
  const app = await WorkerApplication.findOne({ where: { user_id: workerId, status: 'approved' } });
  const prof = await WorkerProfile.findOne({ where: { user_id: workerId, status: 'active' } });
  return !!(app && prof);
}

/** 到家派单：须已审核；有小区时档案或用户表小区须与订单一致 */
async function workerAssignableForServiceOrderWorker(workerId, orderCommunityId) {
  const user = await User.findByPk(workerId, { attributes: ['id', 'phone', 'community_id', 'role'] });
  let app = await WorkerApplication.findOne({ where: { user_id: workerId, status: 'approved' } });
  if (!app && user && user.phone) {
    app = await WorkerApplication.findOne({ where: { phone: String(user.phone), status: 'approved' } });
  }
  if (!app) return { ok: false, reason: '技工未入驻或未审核通过' };

  const prof = await WorkerProfile.findOne({ where: { user_id: workerId, status: 'active' } });
  const isWorkerRole = user && user.role === 'worker';
  if (!app && !prof && !isWorkerRole) {
    return { ok: false, reason: '非技工账号或未入驻' };
  }
  if (orderCommunityId != null) {
    const workerComm =
      prof && prof.community_id != null
        ? Number(prof.community_id)
        : user && user.community_id != null
          ? Number(user.community_id)
          : null;
    // workerComm 为 null 表示技工档案未绑小区，允许管理员跨小区强派
    if (workerComm != null && workerComm !== Number(orderCommunityId)) {
      return { ok: false, reason: '技工所在小区与订单不一致' };
    }
  }
  return { ok: true };
}

function addWorkerToMap(map, userId, row) {
  const uid = userId != null ? String(userId) : '';
  if (!uid || uid === '0') return;
  map.set(uid, {
    id: uid,
    user_id: uid,
    name: row.name || '',
    phone: row.phone || '',
    industry: row.industry || '',
    community_id: row.community_id != null ? row.community_id : null
  });
}

function adminOperatorId(req) {
  const sub = req.admin && req.admin.sub;
  if (sub != null && String(sub).match(/^\d+$/)) return parseInt(sub, 10);
  return 0;
}

/** 中台派单台：扁平化订单行（含九宫格新建 group_key 的到家单） */
function serializeDispatchOrder(row) {
  const j = row.get ? row.get({ plain: true }) : row;
  const buyer = j.buyer || {};
  const svc = j.service || {};
  const snap =
    j.address_snapshot && typeof j.address_snapshot === 'object' ? j.address_snapshot : {};
  let groupKey = j.group_key ? String(j.group_key).trim() : '';
  if (!groupKey && j.remark) {
    const m = String(j.remark).match(/\[类目:([^\]]+)\]/);
    if (m) groupKey = m[1].trim();
  }
  const meta =
    j.fulfillment_meta && typeof j.fulfillment_meta === 'object' ? j.fulfillment_meta : {};
  return {
    id: j.id,
    order_no: j.order_no || null,
    user_id: j.user_id != null ? j.user_id : buyer.id,
    group_key: groupKey,
    service_title: (svc && svc.title) || j.goods_name || '',
    contact_name: j.contact_name || snap.contact_name || buyer.nickname || '',
    contact_phone: j.contact_phone || snap.contact_phone || buyer.phone || '',
    pay_amount: j.amount != null ? String(j.amount) : '',
    address: snap.detail || snap.address || '',
    community_id: j.community_id != null ? j.community_id : null,
    dispatch_mode: meta.dispatch_mode || (j.provider_user_id ? 'provider' : 'admin_dispatch'),
    created_at: j.created_at,
    status: j.status
  };
}

exports.dispatchQueue = async (req, res) => {
  try {
    const [serviceRows, neighborRows] = await Promise.all([
      ServiceOrder.findAll({
        where: {
          status: 'paid_pending_dispatch',
          pay_status: 'paid',
          assigned_worker_id: null
        },
        order: [['created_at', 'ASC']],
        limit: 80,
        include: [
          { model: Service, as: 'service', attributes: ['id', 'title', 'cover_image'] },
          { model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone'] }
        ]
      }),
      NeighborAssistOrder.findAll({
        where: { status: 'paid_pending_dispatch', assigned_worker_id: null },
        order: [['created_at', 'ASC']],
        limit: 80,
        include: [{ model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone'] }]
      })
    ]);
    const service_orders = serviceRows.map(serializeDispatchOrder);
    const neighbor_assist_orders = neighborRows.map((r) => r.get({ plain: true }));
    return ok(res, { service_orders, neighbor_assist_orders });
  } catch (e) {
    console.error('dispatchQueue', e);
    return fail(res, 500, '查询失败');
  }
};

/** GET /admin/housekeeping/workers?community_id= — 派单下拉（同小区技工，含档案与用户表） */
exports.listAssignableWorkers = async (req, res) => {
  try {
    const cid = parseCommunityId(req.query.community_id);
    const map = new Map();

    const profWhere = { status: 'active', user_id: { [Op.ne]: null } };
    const profiles = await WorkerProfile.findAll({
      where: profWhere,
      order: [['real_name', 'ASC']],
      limit: 500,
      include: [{ model: User, as: 'user', attributes: ['id', 'nickname', 'phone', 'community_id', 'role'], required: false }]
    });
    for (const p of profiles) {
      if (p.user_id == null || p.user_id === '') continue;
      const u = p.user || {};
      const effectiveComm =
        p.community_id != null ? Number(p.community_id) : u.community_id != null ? Number(u.community_id) : null;
      if (cid != null) {
        if (effectiveComm == null || effectiveComm !== cid) continue;
      }
      addWorkerToMap(map, p.user_id, {
        name: p.real_name || u.nickname,
        phone: p.phone || u.phone,
        industry: p.industry,
        community_id: effectiveComm
      });
    }

    const userWhere = { role: 'worker' };
    if (cid != null) userWhere.community_id = cid;
    const users = await User.findAll({
      where: userWhere,
      attributes: ['id', 'nickname', 'phone', 'community_id'],
      order: [['nickname', 'ASC']],
      limit: 300
    });
    for (const u of users) {
      addWorkerToMap(map, u.id, {
        name: u.nickname || '',
        phone: u.phone || '',
        industry: '',
        community_id: u.community_id != null ? u.community_id : cid
      });
    }

    const list = Array.from(map.values()).sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
    );
    return ok(res, list);
  } catch (e) {
    console.error('listAssignableWorkers', e);
    return fail(res, 500, '查询技工失败');
  }
};

exports.listServiceOrders = async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const cid = parseCommunityId(req.query.community_id);
    if (cid != null) where.community_id = cid;
    const rows = await ServiceOrder.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(parseInt(req.query.limit, 10) || 200, 500),
      include: [
        { model: Service, as: 'service', attributes: ['id', 'title', 'cover_image', 'price'] },
        { model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone'] },
        { model: User, as: 'assignedWorker', attributes: ['id', 'nickname', 'avatar_url'], required: false }
      ]
    });
    return ok(res, rows);
  } catch (e) {
    console.error('listServiceOrders', e);
    return fail(res, 500, '查询失败');
  }
};

exports.assignServiceOrder = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const worker_id = parseWorkerUserId(req.body || {});
    if (!id || !worker_id) return fail(res, 400, '缺少 id 或 worker_id');
    const order = await ServiceOrder.findByPk(id);
    if (!order) return fail(res, 404, '订单不存在');
    const wchk = await workerAssignableForServiceOrderWorker(worker_id, order.community_id);
    if (!wchk.ok) return fail(res, 400, wchk.reason || '技工不可派单');
    if (order.status !== 'paid_pending_dispatch' || order.assigned_worker_id) {
      return fail(res, 400, '仅「待派单且未指派」的订单可派单');
    }
    order.assigned_worker_id = worker_id;
    order.dispatch_at = new Date();
    order.dispatch_by = adminOperatorId(req);
    order.status = 'dispatched';
    await order.save();
    await order.reload({
      include: [
        { model: Service, as: 'service', attributes: ['id', 'title', 'cover_image', 'price'] },
        { model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone'] },
        { model: User, as: 'assignedWorker', attributes: ['id', 'nickname', 'avatar_url'], required: false }
      ]
    });
    return ok(res, order.get({ plain: true }));
  } catch (e) {
    console.error('assignServiceOrder', e);
    return fail(res, 500, '派单失败');
  }
};

exports.listNeighborAssistOrders = async (req, res) => {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const ncid = parseCommunityId(req.query.community_id);
    if (ncid != null) where.community_id = ncid;
    if (req.query.assist_type) where.assist_type = req.query.assist_type;
    const rows = await NeighborAssistOrder.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(parseInt(req.query.limit, 10) || 200, 500),
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone'] },
        { model: User, as: 'assignedWorker', attributes: ['id', 'nickname', 'avatar_url'], required: false }
      ]
    });
    return ok(res, rows);
  } catch (e) {
    console.error('listNeighborAssistOrders', e);
    return fail(res, 500, '查询失败');
  }
};

exports.assignNeighborAssistOrder = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const worker_id = parseWorkerUserId(req.body || {});
    if (!id || !worker_id) return fail(res, 400, '缺少 id 或 worker_id');
    const order = await NeighborAssistOrder.findByPk(id);
    if (!order) return fail(res, 404, '订单不存在');
    const wchk = await workerAssignableForServiceOrderWorker(worker_id, order.community_id);
    if (!wchk.ok) return fail(res, 400, wchk.reason || '技工不可派单');
    if (order.status !== 'paid_pending_dispatch' || order.assigned_worker_id) {
      return fail(res, 400, '仅「待派单且未指派」的订单可派单');
    }
    order.assigned_worker_id = worker_id;
    order.dispatch_at = new Date();
    order.dispatch_by = adminOperatorId(req);
    order.status = 'dispatched';
    await order.save();
    await order.reload({
      include: [
        { model: User, as: 'buyer', attributes: ['id', 'nickname', 'phone'] },
        { model: User, as: 'assignedWorker', attributes: ['id', 'nickname', 'avatar_url'], required: false }
      ]
    });
    return ok(res, order.get({ plain: true }));
  } catch (e) {
    console.error('assignNeighborAssistOrder', e);
    return fail(res, 500, '派单失败');
  }
};
