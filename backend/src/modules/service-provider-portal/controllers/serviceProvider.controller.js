const db = require('../../../models');
const { ServiceProviderProfile, ServiceItem, ServiceOrder } = db;
const orderPoints = require('../../../services/orderPoints.service');
const commissionService = require('../../commission/services/commission.service');

const ok = (res, data, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg, statusCode = 400) => res.status(statusCode).json({ code: 1, msg });
let spTablesReady = false;

async function ensureSpShopFrontColumn() {
  if (!ServiceProviderProfile || !ServiceProviderProfile.sequelize) return;
  const qi = ServiceProviderProfile.sequelize.getQueryInterface();
  try {
    const desc = await qi.describeTable('service_provider_profiles');
    if (desc && !desc.shop_front_url) {
      await qi.addColumn('service_provider_profiles', 'shop_front_url', {
        type: ServiceProviderProfile.sequelize.Sequelize.STRING(500),
        allowNull: true,
        comment: '门店封面/门头照'
      });
    }
  } catch (e) {
    console.warn('[sp] ensure shop_front_url column:', e.message || e);
  }
}

async function ensureSpTables() {
  if (spTablesReady) return;
  await ensureSpShopFrontColumn();
  await Promise.all([
    ServiceProviderProfile && ServiceProviderProfile.sync ? ServiceProviderProfile.sync() : Promise.resolve(),
    ServiceItem && ServiceItem.sync ? ServiceItem.sync() : Promise.resolve(),
    ServiceOrder && ServiceOrder.sync ? ServiceOrder.sync() : Promise.resolve()
  ]);
  spTablesReady = true;
}

const { resolveUserIdFromReq } = require('../../../utils/resolveUserId');

function getUserId(req) {
  return resolveUserIdFromReq(req);
}

async function getProfileByUser(userId) {
  if (!userId) return null;
  return ServiceProviderProfile.findOne({
    where: { user_id: userId },
    order: [['created_at', 'DESC']]
  });
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    profile_id: row.id,
    user_id: row.user_id,
    shop_name: row.shop_name,
    name: row.shop_name,
    contact_name: row.contact_name,
    contact_phone: row.contact_phone,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    business_hours: row.business_hours,
    description: row.description,
    category: row.category,
    logo: row.logo,
    shop_front_url: row.shop_front_url || row.logo || '',
    status: row.status,
    reject_reason: row.reject_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function normalizeService(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider_id: row.provider_id,
    title: row.title || row.name,
    name: row.name || row.title,
    cover_image: row.cover_image || row.main_image || '',
    main_image: row.main_image || row.cover_image || '',
    image: row.cover_image || row.main_image || '',
    price: Number(row.price),
    price_unit: row.price_unit || row.unit || '次',
    unit: row.unit || row.price_unit || '次',
    category_key: row.category_key || row.service_category || '',
    service_category: row.service_category || row.category_key || '',
    description: row.description || '',
    desc: row.description || '',
    status: row.status,
    is_published: row.is_published,
    on_shelf: row.status === 'on_sale' && row.is_published === 1,
    sales_count: row.sales_count || row.order_count || 0,
    order_count: row.order_count || row.sales_count || 0,
    sort_order: row.sort_order || 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

const SP_STATUS_TEXT = {
  pending_pay: '待支付',
  pending_accept: '待接单',
  paid_pending_dispatch: '待派单',
  dispatched: '已派单',
  in_service: '服务中',
  pending_user_confirm: '待确认完成',
  completed: '已完成',
  cancelled: '已取消',
  closed: '已关闭',
  refunded: '已退款'
};

function normalizeOrder(row) {
  if (!row) return null;
  let evidenceImages = [];
  try {
    evidenceImages = JSON.parse(row.evidence_images || '[]');
  } catch (e) {}
  const statusText = SP_STATUS_TEXT[row.status] || row.status;
  return {
    id: row.id,
    order_no: row.order_no,
    orderNo: row.order_no,
    user_id: row.user_id,
    customer_user_id: row.user_id,
    provider_id: row.provider_id,
    provider_user_id: row.provider_user_id,
    service_id: row.service_id,
    service_title: row.service_title_snapshot || '',
    title: row.service_title_snapshot || '',
    worker_id: row.worker_id,
    worker_user_id: row.worker_user_id,
    status: row.status,
    status_text: statusText,
    statusText: statusText,
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

// ===== 8.1 个人信息 =====

// GET /service-provider/me
exports.getMe = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);
    ok(res, normalizeProfile(profile));
  } catch (err) {
    console.error('[sp/getMe]', err);
    fail(res, '获取信息失败', 500);
  }
};

// PATCH /service-provider/profile
exports.updateProfile = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);
    const body = req.body || {};
    const allowed = ['shop_name', 'logo', 'shop_front_url', 'contact_name', 'contact_phone',
      'address', 'latitude', 'longitude', 'business_hours', 'description', 'category'];
    const updateData = {};
    allowed.forEach((k) => {
      if (body[k] !== undefined) updateData[k] = body[k];
    });
    await profile.update(updateData);
    ok(res, normalizeProfile(profile), '更新成功');
  } catch (err) {
    console.error('[sp/updateProfile]', err);
    fail(res, '更新失败', 500);
  }
};

// ===== 8.2 仪表盘 =====

// GET /service-provider/dashboard
exports.getDashboard = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const providerId = profile.id;
    const pendingOrders = await ServiceOrder.count({
      where: { provider_id: providerId, status: 'pending_accept' }
    });
    const inService = await ServiceOrder.count({
      where: { provider_id: providerId, status: 'in_service' }
    });
    const completed = await ServiceOrder.count({
      where: { provider_id: providerId, status: 'completed' }
    });
    const totalServices = await ServiceItem.count({
      where: { provider_id: providerId }
    });

    ok(res, {
      pending_orders: pendingOrders,
      pendingOrders,
      in_service: inService,
      inService,
      completed,
      completed_today: completed,
      total_services: totalServices,
      totalServices,
      profile: normalizeProfile(profile)
    });
  } catch (err) {
    console.error('[sp/dashboard]', err);
    fail(res, '获取仪表盘失败', 500);
  }
};

// ===== 8.3 服务管理 =====

// GET /service-provider/categories
exports.getCategories = async (req, res) => {
  ok(res, [
    { key: 'cleaning', name: '保洁清洗' },
    { key: 'repair', name: '家电维修' },
    { key: 'plumbing', name: '水电疏通' },
    { key: 'move', name: '搬家拉货' },
    { key: 'nursing', name: '母婴护理' },
    { key: 'elderly', name: '养老陪护' },
    { key: 'beauty', name: '美容美发' },
    { key: 'other', name: '其他服务' }
  ]);
};

// GET /service-provider/services
exports.getServices = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 200);
    const offset = (page - 1) * limit;

    const Op = db.Sequelize.Op;
    const and = [{ provider_id: profile.id }];

    const shelf = query.shelf || query.on_shelf;
    if (shelf === 'on' || shelf === '1' || shelf === 'published') {
      and.push({ status: 'on_sale', is_published: 1 });
    } else if (shelf === 'off' || shelf === '0' || shelf === 'unpublished') {
      and.push({
        [Op.or]: [
          { status: { [Op.ne]: 'on_sale' } },
          { is_published: { [Op.ne]: 1 } }
        ]
      });
    } else if (query.status) {
      and.push({ status: String(query.status) });
    }

    if (query.category_key) and.push({ category_key: String(query.category_key) });

    if (query.keyword) {
      const kw = `%${String(query.keyword).trim()}%`;
      and.push({
        [Op.or]: [
          { title: { [Op.like]: kw } },
          { name: { [Op.like]: kw } }
        ]
      });
    }

    const where = and.length === 1 ? and[0] : { [Op.and]: and };

    const { count, rows } = await ServiceItem.findAndCountAll({
      where,
      order: [['sort_order', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset
    });

    ok(res, { list: rows.map(normalizeService), total: count, page, limit });
  } catch (err) {
    console.error('[sp/services]', err);
    fail(res, '获取服务列表失败', 500);
  }
};

// POST /service-provider/services
exports.createService = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息，请先入驻', 404);

    const body = req.body || {};
    const title = String(body.title || body.name || '').trim();
    if (!title) return fail(res, '服务标题不能为空');

    const price = parseFloat(body.price);
    if (!Number.isFinite(price) || price < 0) return fail(res, '价格格式错误');

    const isPublished = body.is_published === 1 || body.is_published === true || body.published === true || body.on_shelf === true ? 1 : 0;
    const status = isPublished ? 'on_sale' : (body.status || 'off_sale');

    const row = await ServiceItem.create({
      provider_id: profile.id,
      user_id: userId,
      title,
      name: title,
      cover_image: body.cover_image || body.main_image || body.image || '',
      main_image: body.main_image || body.cover_image || body.image || '',
      price,
      price_unit: body.price_unit || body.unit || '次',
      unit: body.unit || body.price_unit || '次',
      category_key: body.category_key || body.service_category || '',
      service_category: body.service_category || body.category_key || '',
      description: body.description || body.desc || '',
      status: isPublished ? 'on_sale' : status,
      is_published: isPublished,
      sort_order: parseInt(body.sort_order, 10) || 0
    });

    ok(res, normalizeService(row), '创建成功');
  } catch (err) {
    console.error('[sp/service/create]', err);
    fail(res, '创建服务失败', 500);
  }
};

// GET /service-provider/services/:id
exports.getServiceDetail = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const id = Number(req.params.id);
    if (!id) return fail(res, '无效服务ID');

    const row = await ServiceItem.findByPk(id);
    if (!row) return fail(res, '服务不存在', 404);

    const profile = await getProfileByUser(userId);
    if (!profile || row.provider_id !== profile.id) {
      return fail(res, '无权查看该服务', 403);
    }

    ok(res, { service: normalizeService(row) });
  } catch (err) {
    console.error('[sp/service/detail]', err);
    fail(res, '获取服务详情失败', 500);
  }
};

// PATCH /service-provider/services/:id
exports.updateService = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const id = Number(req.params.id);
    if (!id) return fail(res, '无效服务ID');

    const row = await ServiceItem.findByPk(id);
    if (!row) return fail(res, '服务不存在', 404);

    const profile = await getProfileByUser(userId);
    if (!profile || row.provider_id !== profile.id) {
      return fail(res, '无权操作该服务', 403);
    }

    const body = req.body || {};
    const updateData = {};

    if (body.title !== undefined || body.name !== undefined) {
      const n = String(body.title || body.name || row.title).trim();
      if (!n) return fail(res, '服务标题不能为空');
      updateData.title = n;
      updateData.name = n;
    }
    if (body.cover_image !== undefined) updateData.cover_image = body.cover_image;
    if (body.main_image !== undefined) updateData.main_image = body.main_image;
    if (body.image !== undefined) { updateData.cover_image = body.image; updateData.main_image = body.image; }
    if (body.price !== undefined) {
      const p = parseFloat(body.price);
      if (!Number.isFinite(p) || p < 0) return fail(res, '价格格式错误');
      updateData.price = p;
    }
    if (body.price_unit !== undefined) { updateData.price_unit = body.price_unit; updateData.unit = body.price_unit; }
    if (body.unit !== undefined) { updateData.unit = body.unit; updateData.price_unit = body.unit; }
    if (body.category_key !== undefined) { updateData.category_key = body.category_key; updateData.service_category = body.category_key; }
    if (body.service_category !== undefined) { updateData.service_category = body.service_category; updateData.category_key = body.service_category; }
    if (body.description !== undefined) { updateData.description = body.description; }
    if (body.desc !== undefined) { updateData.description = body.desc; }
    if (body.sort_order !== undefined) updateData.sort_order = parseInt(body.sort_order, 10) || 0;

    await row.update(updateData);
    ok(res, normalizeService(row), '更新成功');
  } catch (err) {
    console.error('[sp/service/update]', err);
    fail(res, '更新服务失败', 500);
  }
};

// POST /service-provider/services/:id/shelf
exports.shelfService = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const id = Number(req.params.id);
    if (!id) return fail(res, '无效服务ID');

    const row = await ServiceItem.findByPk(id);
    if (!row) return fail(res, '服务不存在', 404);

    const profile = await getProfileByUser(userId);
    if (!profile || row.provider_id !== profile.id) {
      return fail(res, '无权操作该服务', 403);
    }

    const body = req.body || {};
    let published;
    if (body.status === 'on_sale') published = true;
    else if (body.status === 'off_sale') published = false;
    else if (body.published === true || body.published === 1) published = true;
    else if (body.published === false || body.published === 0) published = false;
    else if (body.is_published === 1) published = true;
    else if (body.is_published === 0) published = false;
    else {
      published = row.status !== 'on_sale';
    }

    const newStatus = published ? 'on_sale' : 'off_sale';
    await row.update({ status: newStatus, is_published: published ? 1 : 0 });
    ok(res, normalizeService(row), published ? '上架成功' : '下架成功');
  } catch (err) {
    console.error('[sp/service/shelf]', err);
    fail(res, '上下架操作失败', 500);
  }
};

// ===== 8.4 订单管理 =====

// POST /service-provider/orders/:id/action (通用订单操作)
exports.orderAction = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');

    const row = await ServiceOrder.findOne({
      where: { id, provider_id: profile.id }
    });
    if (!row) return fail(res, '订单不存在', 404);

    const action = String((req.body || {}).action || '').trim();
    const note = String((req.body || {}).note || '').trim();

    if (action === 'accept') {
      if (row.status !== 'pending_accept') return fail(res, '当前状态不可接单');
      await row.update({ status: 'paid_pending_dispatch', provider_user_id: userId });
    } else if (action === 'reject' || action === 'cancel') {
      if (row.status !== 'pending_accept') return fail(res, '当前状态不可拒单');
      if (row.pay_status === 'paid') {
        await orderPoints.revokePointsOnOrderRefund(ServiceOrder, row, null);
        try { await commissionService.revertCommission(String(row.id)); } catch (ce) { console.warn('[sp/commission-revert]', ce.message); }
      }
      await row.update({
        status: 'cancelled',
        pay_status: row.pay_status === 'paid' ? 'refunded' : row.pay_status,
        cancel_reason: note || '商家拒单',
        cancelled_at: new Date()
      });
    } else if (action === 'dispatch') {
      if (!['pending_accept', 'paid_pending_dispatch'].includes(String(row.status))) {
        return fail(res, '当前状态不可派单');
      }
      const workerId = Number((req.body || {}).worker_id || 0);
      if (!workerId) return fail(res, '请选择技工');
      await row.update({ status: 'dispatched', worker_id: workerId, provider_user_id: userId });
    } else if (action === 'check-in') {
      if (!['paid_pending_dispatch', 'dispatched', 'in_service'].includes(String(row.status))) {
        return fail(res, '当前状态不可打卡');
      }
      await row.update({ status: 'in_service', check_in_at: new Date(), check_in_location: note || '', provider_user_id: userId });
    } else if (action === 'evidence') {
      if (!['in_service', 'dispatched'].includes(String(row.status))) {
        return fail(res, '当前状态不可上传凭证');
      }
      const images = Array.isArray((req.body || {}).proof_images) ? req.body.proof_images : [];
      await row.update({ evidence_images: JSON.stringify(images), evidence_note: note || '' });
    } else if (action === 'complete') {
      if (!['in_service', 'dispatched'].includes(String(row.status))) {
        return fail(res, '当前状态不可完成');
      }
      const images = Array.isArray((req.body || {}).proof_images) ? req.body.proof_images : [];
      const updateData = { status: 'pending_user_confirm', completed_at: new Date() };
      if (images.length) updateData.evidence_images = JSON.stringify(images);
      if (note) updateData.evidence_note = note;
      await row.update(updateData);
    } else {
      return fail(res, '不支持的操作');
    }

    ok(res, { id: row.id, status: row.status, order_status: row.status }, '操作成功');
  } catch (err) {
    console.error('[sp/order/action]', err);
    fail(res, '订单操作失败', 500);
  }
};

// GET /service-provider/orders
exports.getOrders = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const where = { provider_id: profile.id };
    if (query.status) where.status = String(query.status);
    if (query.pay_status) where.pay_status = String(query.pay_status);

    const { count, rows } = await ServiceOrder.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    ok(res, { list: rows.map(normalizeOrder), total: count, page, limit });
  } catch (err) {
    console.error('[sp/orders]', err);
    fail(res, '获取订单列表失败', 500);
  }
};

// GET /service-provider/orders/:id
exports.getOrderDetail = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');

    const row = await ServiceOrder.findOne({
      where: { id, provider_id: profile.id }
    });
    if (!row) return fail(res, '订单不存在', 404);

    ok(res, { order: normalizeOrder(row) });
  } catch (err) {
    console.error('[sp/order/detail]', err);
    fail(res, '获取订单详情失败', 500);
  }
};

// POST /service-provider/orders/:id/accept
exports.acceptOrder = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');

    const row = await ServiceOrder.findOne({
      where: { id, provider_id: profile.id }
    });
    if (!row) return fail(res, '订单不存在', 404);
    if (row.status !== 'pending_accept') return fail(res, '当前状态不可接单');

    await row.update({ status: 'paid_pending_dispatch', provider_user_id: userId });
    ok(res, { id: row.id, status: row.status }, '接单成功');
  } catch (err) {
    console.error('[sp/order/accept]', err);
    fail(res, '接单失败', 500);
  }
};

// POST /service-provider/orders/:id/dispatch
exports.dispatchOrder = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');

    const row = await ServiceOrder.findOne({
      where: { id, provider_id: profile.id }
    });
    if (!row) return fail(res, '订单不存在', 404);
    if (!['pending_accept', 'paid_pending_dispatch'].includes(String(row.status))) {
      return fail(res, '当前状态不可派单');
    }

    const workerId = Number((req.body || {}).worker_id || 0);
    if (!workerId) return fail(res, '请选择技工');

    await row.update({
      status: 'dispatched',
      worker_id: workerId,
      provider_user_id: userId
    });
    ok(res, { id: row.id, status: row.status, worker_id: workerId }, '派单成功');
  } catch (err) {
    console.error('[sp/order/dispatch]', err);
    fail(res, '派单失败', 500);
  }
};

// POST /service-provider/orders/:id/reject
exports.rejectOrder = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');

    const row = await ServiceOrder.findOne({
      where: { id, provider_id: profile.id }
    });
    if (!row) return fail(res, '订单不存在', 404);
    if (row.status !== 'pending_accept') return fail(res, '当前状态不可拒单');

    const note = String((req.body || {}).reason || '商家拒单').trim();
    if (row.pay_status === 'paid') {
      await orderPoints.revokePointsOnOrderRefund(ServiceOrder, row, null);
      try { await commissionService.revertCommission(String(row.id)); } catch (ce) { console.warn('[sp/reject-commission-revert]', ce.message); }
    }
    await row.update({
      status: 'cancelled',
      pay_status: row.pay_status === 'paid' ? 'refunded' : row.pay_status,
      cancel_reason: note,
      cancelled_at: new Date()
    });
    ok(res, { id: row.id, status: row.status }, '已拒单');
  } catch (err) {
    console.error('[sp/order/reject]', err);
    fail(res, '拒单失败', 500);
  }
};

// POST /service-provider/orders/:id/check-in
exports.checkIn = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');

    const row = await ServiceOrder.findOne({
      where: { id, provider_id: profile.id }
    });
    if (!row) return fail(res, '订单不存在', 404);
    if (!['paid_pending_dispatch', 'dispatched', 'in_service'].includes(String(row.status))) {
      return fail(res, '当前状态不可打卡');
    }

    const body = req.body || {};
    const location = body.location || body.check_in_location || '';
    await row.update({
      status: 'in_service',
      check_in_at: new Date(),
      check_in_location: location,
      provider_user_id: userId
    });
    ok(res, { id: row.id, status: row.status, check_in_at: row.check_in_at }, '打卡成功');
  } catch (err) {
    console.error('[sp/order/check-in]', err);
    fail(res, '打卡失败', 500);
  }
};

// POST /service-provider/orders/:id/evidence
exports.uploadEvidence = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');

    const row = await ServiceOrder.findOne({
      where: { id, provider_id: profile.id }
    });
    if (!row) return fail(res, '订单不存在', 404);
    if (!['in_service', 'dispatched'].includes(String(row.status))) {
      return fail(res, '当前状态不可上传凭证');
    }

    const body = req.body || {};
    const images = Array.isArray(body.proof_images) ? body.proof_images : [];
    const note = String(body.note || '').trim();

    await row.update({
      evidence_images: JSON.stringify(images),
      evidence_note: note
    });
    ok(res, { id: row.id, evidence_images: images, evidence_note: note }, '上传成功');
  } catch (err) {
    console.error('[sp/order/evidence]', err);
    fail(res, '上传凭证失败', 500);
  }
};

// POST /service-provider/orders/:id/complete
exports.completeOrder = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const id = Number(req.params.id);
    if (!id) return fail(res, '无效订单ID');

    const row = await ServiceOrder.findOne({
      where: { id, provider_id: profile.id }
    });
    if (!row) return fail(res, '订单不存在', 404);
    if (!['in_service', 'dispatched'].includes(String(row.status))) {
      return fail(res, '当前状态不可完成');
    }

    const body = req.body || {};
    const images = Array.isArray(body.proof_images) ? body.proof_images : [];
    const note = String(body.note || '').trim();

    const updateData = {
      status: 'pending_user_confirm',
      completed_at: new Date()
    };
    if (images.length) updateData.evidence_images = JSON.stringify(images);
    if (note) updateData.evidence_note = note;

    await row.update(updateData);
    ok(res, { id: row.id, status: row.status }, '服务已完成');
  } catch (err) {
    console.error('[sp/order/complete]', err);
    fail(res, '完成服务失败', 500);
  }
};

// ===== 8.5 技工管理（返回空数据/501） =====

exports.getWorkers = async (req, res) => {
  ok(res, { list: [], total: 0 });
};

exports.getWorkerDetail = async (req, res) => {
  fail(res, '由主后端实现', 501);
};

exports.updateWorkerStatus = async (req, res) => {
  fail(res, '由主后端实现', 501);
};

exports.getWorkerStats = async (req, res) => {
  fail(res, '由主后端实现', 501);
};

// ===== 8.6 财务管理（简单实现） =====

exports.getIncomeSummary = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const completedCount = await ServiceOrder.count({
      where: { provider_id: profile.id, status: 'completed' }
    });
    const totalIncome = await ServiceOrder.sum('pay_amount', {
      where: { provider_id: profile.id, status: 'completed' }
    }) || 0;

    ok(res, {
      total_income: Number(totalIncome).toFixed(2),
      completed_orders: completedCount,
      pending_settlement: '0.00',
      settled: Number(totalIncome).toFixed(2)
    });
  } catch (err) {
    console.error('[sp/income/summary]', err);
    fail(res, '获取收入汇总失败', 500);
  }
};

exports.getIncomeList = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { count, rows } = await ServiceOrder.findAndCountAll({
      where: { provider_id: profile.id, status: 'completed' },
      order: [['completed_at', 'DESC']],
      limit,
      offset
    });

    ok(res, {
      list: rows.map((r) => ({
        order_no: r.order_no,
        amount: Number(r.pay_amount || r.amount || 0).toFixed(2),
        completed_at: r.completed_at,
        status: 'settled'
      })),
      total: count,
      page,
      limit
    });
  } catch (err) {
    console.error('[sp/income/list]', err);
    fail(res, '获取收入列表失败', 500);
  }
};

exports.getDailyIncome = async (req, res) => {
  ok(res, { list: [], total: 0 });
};

exports.getBalance = async (req, res) => {
  try {
    await ensureSpTables();
    const userId = getUserId(req);
    if (!userId) return fail(res, '未登录', 401);
    const profile = await getProfileByUser(userId);
    if (!profile) return fail(res, '暂无服务商信息', 404);

    const { Op, literal } = require('sequelize');
    const whereBase = {
      status: 'completed',
      [Op.or]: [
        { provider_id: profile.id },
        { provider_user_id: String(userId) }
      ]
    };

    // Use COALESCE to handle orders where only amount is set
    const db = require('../../../models');
    const [[{ total }]] = await db.sequelize.query(
      `SELECT COALESCE(SUM(COALESCE(pay_amount, amount)), 0) AS total
       FROM service_orders
       WHERE status = 'completed'
         AND (provider_id = :pid OR provider_user_id = :uid)`,
      { replacements: { pid: profile.id, uid: String(userId) }, type: db.sequelize.QueryTypes.SELECT, raw: true }
    ).catch(() => [[{ total: 0 }]]);

    const totalIncome = Number(total) || 0;

    // Also check PartnerCommissionBalance for 'service_provider' role (credited by confirmComplete)
    let commBalance = 0;
    try {
      const { PartnerCommissionBalance } = require('../../../models');
      if (PartnerCommissionBalance) {
        const cb = await PartnerCommissionBalance.findOne({
          where: { user_id: String(userId), role: 'service_provider' }
        });
        if (cb) commBalance = Number(cb.available_amount || 0);
      }
    } catch (_) {}

    const withdrawable = commBalance > 0 ? commBalance : totalIncome;

    ok(res, {
      balance: withdrawable.toFixed(2),
      total_income: totalIncome.toFixed(2),
      withdrawable: withdrawable.toFixed(2),
      provider_balance: withdrawable.toFixed(2)
    });
  } catch (err) {
    console.error('[sp/balance]', err);
    fail(res, '获取余额失败', 500);
  }
};
