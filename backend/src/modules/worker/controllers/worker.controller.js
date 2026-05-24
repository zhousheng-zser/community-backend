const { Op } = require('sequelize');
const db = require('../../../models');
const { WorkerApplication, ServiceOrder, WorkerService, Service, WorkerProfile, User } = db;
const orderPoints = require('../../../services/orderPoints.service');
const { resolveUserIdFromReq } = require('../../../utils/resolveUserId');
const { ensureWorkerVisibleInCommunity, DEFAULT_COMMUNITY_ID } = require('../../../services/workerVisibility.service');

function normMediaUrl(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'object' && v.url) return String(v.url).trim().slice(0, 500);
  return String(v).trim().slice(0, 500);
}

function normCertUrls(v) {
  const out = [];
  const walk = (x) => {
    if (x == null || x === '') return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === 'object' && x.url) return walk(x.url);
    const s = normMediaUrl(x);
    if (s) out.push(s);
  };
  walk(v);
  return out;
}

function normServices(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [];
  return arr
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name || '').trim();
      if (!name) return null;
      return {
        name,
        price: item.price != null ? String(item.price).trim() : '',
        desc: item.desc != null ? String(item.desc).trim() : ''
      };
    })
    .filter(Boolean);
}

async function findLatestApplication(userId) {
  return WorkerApplication.findOne({
    where: { user_id: userId },
    order: [['created_at', 'DESC'], ['id', 'DESC']]
  });
}

async function supersedeOtherPending(userId, keepId) {
  if (!userId || !keepId) return;
  await WorkerApplication.update(
    { status: 'rejected', reject_reason: '已重新提交，本条申请自动关闭' },
    { where: { user_id: userId, status: 'pending', id: { [Op.ne]: keepId } } }
  );
}

// POST /worker/apply
exports.apply = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) {
      return res.status(401).json({ code: 1, msg: '未登录' });
    }
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const phone = String(body.phone || '').trim();
    const industry = String(body.industry || '').trim();
    const idCardUrl = normMediaUrl(body.id_card_url);
    if (!name || !phone || !industry || !idCardUrl) {
      return res.status(400).json({
        code: 1,
        msg: '请填写姓名、手机号、意向行业并上传身份证照片'
      });
    }
    const payload = {
      user_id: userId,
      name,
      phone,
      industry,
      education: body.education ? String(body.education).trim() : null,
      city: body.city ? String(body.city).trim() : null,
      resume: body.resume ? String(body.resume).trim() : null,
      id_card_url: idCardUrl.slice(0, 255),
      work_photo_url: normMediaUrl(body.work_photo_url) || null,
      certificate_url: normCertUrls(body.certificate_url),
      services: normServices(body.services),
      status: 'pending',
      reject_reason: ''
    };

    const latest = await findLatestApplication(userId);
    if (latest && latest.status === 'approved') {
      return res.json({
        code: 0,
        msg: '您已是认证技工，无需重复申请',
        data: { application_id: latest.id, status: 'approved' }
      });
    }

    let record;
    if (latest) {
      await latest.update({
        ...payload,
        reviewed_by: null,
        reviewed_at: null
      });
      record = latest;
    } else {
      record = await WorkerApplication.create(payload);
    }
    await supersedeOtherPending(userId, record.id);

    return res.json({
      code: 0,
      msg: '提交成功',
      data: { application_id: record.id, status: 'pending' }
    });
  } catch (err) {
    console.error('[worker/apply] error:', err);
    return res.status(500).json({ code: 1, msg: '提交失败，请重试' });
  }
};

// GET /worker/applications
exports.getApplications = async (req, res) => {
  try {
    const { status, page = 1, pageSize = 20 } = req.query || {};
    const where = {};
    if (status) where.status = status;
    const { count, rows } = await WorkerApplication.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      offset: (Number(page) - 1) * Number(pageSize),
      limit: Number(pageSize)
    });
    return res.json({ code: 0, data: { list: rows, total: count, page: Number(page), pageSize: Number(pageSize) } });
  } catch (err) {
    console.error('[worker/applications] error:', err);
    return res.status(500).json({ code: 1, msg: '查询失败' });
  }
};

// POST /worker/applications/:id/review
exports.reviewApplication = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reviewerId = resolveUserIdFromReq(req);
    const { status, reject_reason } = req.body || {};
    if (!id || !status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ code: 1, msg: '参数错误' });
    }
    const record = await WorkerApplication.findByPk(id);
    if (!record) {
      return res.status(404).json({ code: 1, msg: '申请记录不存在' });
    }
    await record.update({
      status,
      reject_reason: status === 'rejected' ? (reject_reason || '') : '',
      reviewed_by: reviewerId,
      reviewed_at: new Date()
    });
    if (status === 'approved') {
      await ensureWorkerVisibleInCommunity(record.user_id, DEFAULT_COMMUNITY_ID);
    }
    return res.json({ code: 0, msg: '审核完成', data: { id, status } });
  } catch (err) {
    console.error('[worker/applications/review] error:', err);
    return res.status(500).json({ code: 1, msg: '审核失败' });
  }
};

// GET /worker/application/me
exports.getMyApplication = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) {
      return res.status(401).json({ code: 1, msg: '未登录' });
    }
    const record = await WorkerApplication.findOne({ where: { user_id: userId }, order: [['created_at', 'DESC']] });
    if (!record) {
      return res.status(404).json({ code: 1, msg: '暂无申请记录' });
    }
    return res.json({ code: 0, data: record });
  } catch (err) {
    console.error('[worker/application/me] error:', err);
    return res.status(500).json({ code: 1, msg: '查询失败' });
  }
};

function getWorkerUserId(req) {
  return resolveUserIdFromReq(req);
}

function normalizeWorkerOrder(row) {
  if (!row) return null;
  let evidenceImages = [];
  try { evidenceImages = JSON.parse(row.evidence_images || '[]'); } catch (e) {}
  return {
    id: row.id,
    order_no: row.order_no,
    orderNo: row.order_no,
    user_id: row.user_id,
    customer_user_id: row.user_id,
    provider_id: row.provider_id,
    service_id: row.service_id,
    service_title: row.service_title_snapshot || '',
    title: row.service_title_snapshot || '',
    worker_id: row.worker_id,
    worker_user_id: row.worker_user_id,
    status: row.status,
    pay_status: row.pay_status,
    pay_amount: Number(row.pay_amount || row.amount || 0).toFixed(2),
    amount: Number(row.pay_amount || row.amount || 0).toFixed(2),
    contact_name: row.contact_name || '',
    contact_phone: row.contact_phone || '',
    address: row.address || row.service_address || '',
    service_address: row.service_address || row.address || '',
    appointment_time: row.appointment_time || row.book_time || '',
    book_time: row.book_time || row.appointment_time || '',
    remark: row.remark || '',
    cancel_reason: row.cancel_reason || '',
    check_in_at: row.check_in_at,
    check_in_location: row.check_in_location || '',
    evidence_images: evidenceImages,
    evidence_note: row.evidence_note || '',
    completed_at: row.completed_at,
    paid_at: row.paid_at,
    cancelled_at: row.cancelled_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// GET /worker/service-orders
exports.getOrders = async (req, res) => {
  try {
    const userId = getWorkerUserId(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;
    const where = { worker_user_id: userId };
    if (query.status) where.status = String(query.status);
    const { count, rows } = await ServiceOrder.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });
    return res.json({ code: 0, data: { list: rows.map(normalizeWorkerOrder), total: count, page, limit } });
  } catch (err) {
    console.error('[worker/orders]', err);
    return res.status(500).json({ code: 1, msg: '获取订单列表失败' });
  }
};

// GET /worker/service-orders/:id
exports.getOrderDetail = async (req, res) => {
  try {
    const userId = getWorkerUserId(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ code: 1, msg: '无效订单ID' });
    const row = await ServiceOrder.findOne({ where: { id, worker_user_id: userId } });
    if (!row) return res.status(404).json({ code: 1, msg: '订单不存在' });
    return res.json({ code: 0, data: { order: normalizeWorkerOrder(row) } });
  } catch (err) {
    console.error('[worker/order/detail]', err);
    return res.status(500).json({ code: 1, msg: '获取订单详情失败' });
  }
};

// POST /worker/service-orders/:id/accept
exports.acceptOrder = async (req, res) => {
  try {
    const userId = getWorkerUserId(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ code: 1, msg: '无效订单ID' });
    const row = await ServiceOrder.findOne({ where: { id, worker_user_id: userId } });
    if (!row) return res.status(404).json({ code: 1, msg: '订单不存在' });
    if (row.status !== 'dispatched') return res.status(400).json({ code: 1, msg: '当前状态不可接单' });
    await row.update({ status: 'in_service', worker_user_id: userId });
    return res.json({ code: 0, data: { id: row.id, status: row.status }, msg: '接单成功' });
  } catch (err) {
    console.error('[worker/order/accept]', err);
    return res.status(500).json({ code: 1, msg: '接单失败' });
  }
};

// POST /worker/service-orders/:id/reject
exports.rejectOrder = async (req, res) => {
  try {
    const userId = getWorkerUserId(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ code: 1, msg: '无效订单ID' });
    const row = await ServiceOrder.findOne({ where: { id, worker_user_id: userId } });
    if (!row) return res.status(404).json({ code: 1, msg: '订单不存在' });
    if (row.status !== 'dispatched') return res.status(400).json({ code: 1, msg: '当前状态不可拒单' });
    const note = String((req.body || {}).reason || '技工拒单').trim();
    if (row.pay_status === 'paid') {
      await orderPoints.revokePointsOnOrderRefund(ServiceOrder, row, null);
    }
    await row.update({
      status: 'cancelled',
      pay_status: row.pay_status === 'paid' ? 'refunded' : row.pay_status,
      cancel_reason: note,
      cancelled_at: new Date()
    });
    return res.json({ code: 0, data: { id: row.id, status: row.status }, msg: '已拒单' });
  } catch (err) {
    console.error('[worker/order/reject]', err);
    return res.status(500).json({ code: 1, msg: '拒单失败' });
  }
};

// POST /worker/service-orders/:id/check-in
exports.checkIn = async (req, res) => {
  try {
    const userId = getWorkerUserId(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ code: 1, msg: '无效订单ID' });
    const row = await ServiceOrder.findOne({ where: { id, worker_user_id: userId } });
    if (!row) return res.status(404).json({ code: 1, msg: '订单不存在' });
    if (!['dispatched', 'in_service'].includes(String(row.status))) {
      return res.status(400).json({ code: 1, msg: '当前状态不可打卡' });
    }
    const body = req.body || {};
    const location = body.location || body.check_in_location || '';
    await row.update({
      status: 'in_service',
      check_in_at: new Date(),
      check_in_location: location,
      worker_user_id: userId
    });
    return res.json({ code: 0, data: { id: row.id, status: row.status, check_in_at: row.check_in_at }, msg: '打卡成功' });
  } catch (err) {
    console.error('[worker/order/check-in]', err);
    return res.status(500).json({ code: 1, msg: '打卡失败' });
  }
};

// POST /worker/service-orders/:id/evidence
exports.uploadEvidence = async (req, res) => {
  try {
    const userId = getWorkerUserId(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ code: 1, msg: '无效订单ID' });
    const row = await ServiceOrder.findOne({ where: { id, worker_user_id: userId } });
    if (!row) return res.status(404).json({ code: 1, msg: '订单不存在' });
    if (!['in_service', 'dispatched'].includes(String(row.status))) {
      return res.status(400).json({ code: 1, msg: '当前状态不可上传凭证' });
    }
    const body = req.body || {};
    const images = Array.isArray(body.urls) ? body.urls : (Array.isArray(body.proof_images) ? body.proof_images : []);
    const note = String(body.note || '').trim();
    let existing = [];
    try { existing = JSON.parse(row.evidence_images || '[]'); } catch (e) {}
    const merged = Array.isArray(existing) ? existing.concat(images) : images;
    await row.update({ evidence_images: JSON.stringify(merged.slice(0, 10)), evidence_note: note || row.evidence_note || '' });
    return res.json({ code: 0, data: { id: row.id, evidence_images: merged.slice(0, 10) }, msg: '上传成功' });
  } catch (err) {
    console.error('[worker/order/evidence]', err);
    return res.status(500).json({ code: 1, msg: '上传凭证失败' });
  }
};

// POST /worker/service-orders/:id/complete
exports.completeOrder = async (req, res) => {
  try {
    const userId = getWorkerUserId(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ code: 1, msg: '无效订单ID' });
    const row = await ServiceOrder.findOne({ where: { id, worker_user_id: userId } });
    if (!row) return res.status(404).json({ code: 1, msg: '订单不存在' });
    if (!['in_service', 'dispatched'].includes(String(row.status))) {
      return res.status(400).json({ code: 1, msg: '当前状态不可完成' });
    }
    await row.update({ status: 'pending_user_confirm', completed_at: new Date() });
    return res.json({ code: 0, data: { id: row.id, status: row.status }, msg: '服务已完成' });
  } catch (err) {
    console.error('[worker/order/complete]', err);
    return res.status(500).json({ code: 1, msg: '完成服务失败' });
  }
};

// ===== 技工服务管理 =====

function parseWorkerPrice(raw) {
  if (raw == null || raw === '') return 0;
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeWorkerServiceRow(link) {
  const j = link.toJSON ? link.toJSON() : link;
  const svc = j.service || {};
  return {
    id: j.id,
    service_id: j.service_id,
    name: svc.title || '',
    price: svc.price != null ? String(svc.price) : '',
    desc: svc.description || '',
    cover_image: svc.cover_image || '',
    enabled: j.enabled
  };
}

async function findWorkerServiceLink(userId, linkId) {
  return WorkerService.findOne({
    where: { id: linkId, worker_user_id: userId },
    include: [{ model: Service, as: 'service', required: false }]
  });
}

// GET /worker/services
exports.getMyServices = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    let limit = parseInt(req.query.limit, 10) || 20;
    limit = Math.min(Math.max(limit, 1), 50);
    const offset = (page - 1) * limit;

    const { count, rows } = await WorkerService.findAndCountAll({
      where: { worker_user_id: userId },
      include: [{ model: Service, as: 'service', required: false }],
      order: [['sort_order', 'ASC'], ['created_at', 'DESC']],
      limit,
      offset
    });

    return res.json({
      code: 0,
      data: {
        list: rows.map(normalizeWorkerServiceRow),
        total: count,
        page,
        limit
      }
    });
  } catch (err) {
    console.error('[worker/services] error:', err);
    return res.status(500).json({ code: 1, msg: '查询失败' });
  }
};

// POST /worker/services — 创建平台服务并关联到技工
exports.createService = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });

    const { name, price, desc, cover_image } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ code: 1, msg: '服务名称不能为空' });
    }

    const title = String(name).trim();
    const priceNum = parseWorkerPrice(price);
    const description = desc ? String(desc).trim() : '';
    const cover = cover_image ? String(cover_image).trim() : '';

    const svc = await Service.create({
      title,
      description,
      price: priceNum,
      cover_image: cover,
      is_published: 1
    });

    const link = await WorkerService.create({
      worker_user_id: userId,
      service_id: svc.id,
      enabled: 1
    });

    return res.json({ code: 0, msg: '创建成功', data: normalizeWorkerServiceRow({ ...link.toJSON(), service: svc }) });
  } catch (err) {
    console.error('[worker/services/create] error:', err);
    return res.status(500).json({ code: 1, msg: err.message || '创建失败' });
  }
};

// PATCH /worker/services/:id
exports.updateService = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });

    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ code: 1, msg: '无效服务ID' });

    const row = await findWorkerServiceLink(userId, id);
    if (!row) return res.status(404).json({ code: 1, msg: '服务不存在' });

    const { name, price, desc, cover_image } = req.body || {};

    if (row.service_id && Service) {
      const svcUpdate = {};
      if (name !== undefined) svcUpdate.title = String(name).trim();
      if (price !== undefined) svcUpdate.price = parseWorkerPrice(price);
      if (desc !== undefined) svcUpdate.description = desc || '';
      if (cover_image !== undefined) svcUpdate.cover_image = cover_image || '';
      if (Object.keys(svcUpdate).length) {
        await Service.update(svcUpdate, { where: { id: row.service_id } });
      }
    }

    const refreshed = await findWorkerServiceLink(userId, id);
    return res.json({ code: 0, msg: '更新成功', data: normalizeWorkerServiceRow(refreshed) });
  } catch (err) {
    console.error('[worker/services/update] error:', err);
    return res.status(500).json({ code: 1, msg: '更新失败' });
  }
};

// POST /worker/services/:id/delete
exports.deleteService = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });

    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ code: 1, msg: '无效服务ID' });

    const row = await findWorkerServiceLink(userId, id);
    if (!row) return res.status(404).json({ code: 1, msg: '服务不存在' });

    const sid = row.service_id;
    await row.destroy();
    if (sid && Service) {
      const others = await WorkerService.count({ where: { service_id: sid } });
      if (others === 0) {
        try {
          await Service.update({ is_published: 0 }, { where: { id: sid } });
        } catch (e) { /* ignore */ }
      }
    }
    return res.json({ code: 0, msg: '删除成功' });
  } catch (err) {
    console.error('[worker/services/delete] error:', err);
    return res.status(500).json({ code: 1, msg: '删除失败' });
  }
};

// GET /worker/profile/me — 工作台头像与封面
exports.getMyProfile = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });

    let avatarUrl = '';
    if (User) {
      const user = await User.findByPk(userId, { attributes: ['id', 'avatar_url', 'nickname'] });
      avatarUrl = (user && user.avatar_url) || '';
    }

    const approvedApp = await WorkerApplication.findOne({
      where: { user_id: userId, status: 'approved' },
      order: [['updated_at', 'DESC']]
    });

    let workPhotoUrl = (approvedApp && approvedApp.work_photo_url) || '';
    if (WorkerProfile) {
      const prof = await WorkerProfile.findOne({
        where: { user_id: userId, status: 'active' },
        order: [['updated_at', 'DESC']]
      });
      if (prof && prof.work_photo_url) workPhotoUrl = prof.work_photo_url;
    }

    return res.json({
      code: 0,
      data: {
        avatar_url: avatarUrl,
        work_photo_url: workPhotoUrl
      }
    });
  } catch (err) {
    console.error('[worker/profile/me] error:', err);
    return res.status(500).json({ code: 1, msg: '获取资料失败' });
  }
};

// PATCH /worker/profile/me — 更新头像 / 工作台封面（工作生活照）
exports.updateMyProfile = async (req, res) => {
  try {
    const userId = resolveUserIdFromReq(req);
    if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });

    const body = req.body || {};
    if (body.avatar_url !== undefined && User) {
      const user = await User.findByPk(userId);
      if (user) {
        user.avatar_url = body.avatar_url ? String(body.avatar_url).trim() : '';
        await user.save();
      }
    }

    if (body.work_photo_url !== undefined) {
      const photo = body.work_photo_url ? String(body.work_photo_url).trim() : '';
      if (WorkerProfile) {
        let prof = await WorkerProfile.findOne({
          where: { user_id: userId, status: 'active' },
          order: [['updated_at', 'DESC']]
        });
        if (!prof) {
          const approvedApp = await WorkerApplication.findOne({
            where: { user_id: userId, status: 'approved' },
            order: [['updated_at', 'DESC']]
          });
          if (approvedApp) {
            prof = await WorkerProfile.create({
              user_id: userId,
              community_id: approvedApp.community_id || null,
              real_name: approvedApp.name || '',
              industry: approvedApp.industry || '',
              city: approvedApp.city || '',
              resume: approvedApp.resume || '',
              work_photo_url: photo,
              status: 'active'
            });
          }
        } else {
          await prof.update({ work_photo_url: photo });
        }
      }
      await WorkerApplication.update(
        { work_photo_url: photo },
        { where: { user_id: userId, status: 'approved' } }
      );
    }

    return exports.getMyProfile(req, res);
  } catch (err) {
    console.error('[worker/profile/me] update error:', err);
    return res.status(500).json({ code: 1, msg: '更新失败' });
  }
};
