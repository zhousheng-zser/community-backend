const { Op } = require('sequelize');
const db = require('../../../models');
const { ServiceOrder, WorkerApplication } = db;

const ok = (res, data, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg, statusCode = 400) => res.status(statusCode).json({ code: 1, msg });

function isAdmin(req) {
  const u = req.user || {};
  if (u.admin === true || u.is_admin === true) return true;
  const roleRaw = u.role;
  if (Array.isArray(roleRaw)) return roleRaw.includes('admin');
  if (typeof roleRaw === 'string') return roleRaw.split(',').map((x) => x.trim()).includes('admin');
  return false;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_no: row.order_no,
    user_id: row.user_id,
    service_title: row.service_title_snapshot || '',
    address: row.address || row.service_address || '',
    contact_name: row.contact_name || '',
    contact_phone: row.contact_phone || '',
    pay_amount: row.pay_amount != null ? String(row.pay_amount) : '0',
    status: row.status,
    remark: row.remark || '',
    created_at: row.created_at
  };
}

/** GET /admin/dispatch-queue — 待管理员派单的平台订单 */
exports.queue = async (req, res) => {
  try {
    if (!isAdmin(req)) return fail(res, '无管理员权限', 403);
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    const rows = await ServiceOrder.findAll({
      where: {
        status: 'paid_pending_dispatch',
        pay_status: 'paid',
        [Op.or]: [
          { worker_user_id: { [Op.is]: null } },
          { worker_user_id: 0 }
        ]
      },
      order: [['created_at', 'DESC']],
      limit
    });
    ok(res, {
      service_orders: rows.map(mapRow),
      neighbor_assist_orders: []
    }, 'ok');
  } catch (e) {
    console.error('[admin/dispatch-queue]', e);
    fail(res, '查询失败', 500);
  }
};

/** POST /admin/service-orders/:id/assign — 派单给技工用户 user_id */
exports.assignWorker = async (req, res) => {
  try {
    if (!isAdmin(req)) return fail(res, '无管理员权限', 403);
    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');
    const body = req.body || {};
    // 雪花 ID 为大整数，禁止用 Number() 转换（精度丢失）；保持字符串形式传给 Sequelize
    const rawWorkerId = body.worker_user_id || body.worker_id;
    const workerUserId = rawWorkerId != null && rawWorkerId !== '' ? String(rawWorkerId).trim() : null;
    if (!workerUserId || !/^\d+$/.test(workerUserId)) return fail(res, '缺少 worker_user_id');

    if (WorkerApplication) {
      const workerAppr = await WorkerApplication.findOne({
        where: { user_id: workerUserId, status: 'approved' }
      });
      if (!workerAppr) return fail(res, '该用户不是已认证技工', 400);
    }

    const row = await ServiceOrder.findByPk(id);
    if (!row) return fail(res, '订单不存在', 404);
    if (row.status !== 'paid_pending_dispatch') {
      return fail(res, '仅待平台派单状态的订单可指派', 400);
    }
    const existingWu = row.worker_user_id != null ? String(row.worker_user_id) : '';
    if (existingWu && existingWu !== '0') return fail(res, '订单已指派技工', 400);

    await row.update({
      worker_user_id: workerUserId,
      worker_id: workerUserId,
      status: 'dispatched'
    });

    ok(res, { id: row.id, status: row.status, worker_user_id: workerUserId }, '派单成功');
  } catch (e) {
    console.error('[admin/assign]', e);
    fail(res, '派单失败', 500);
  }
};
