const { Op } = require('sequelize');
const db = require('../models');
const {
  HomeDisplayItem,
  WorkerProfile,
  WorkerApplication,
  User,
  Service,
  ServiceProviderProfile
} = db;
const { ensureWorkerVisibleInCommunity, DEFAULT_COMMUNITY_ID } = require('../services/workerVisibility.service');
const { resolveUserId } = require('../utils/resolveUserId');

let tableReady = false;
async function ensureTable() {
  if (tableReady || !HomeDisplayItem) return;
  await HomeDisplayItem.sync();
  tableReady = true;
}

function okRows(rows, total) {
  return { rows, total: total != null ? total : rows.length };
}

exports.listItems = async (req, res) => {
  try {
    await ensureTable();
    const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 200, 500);
    const rows = await HomeDisplayItem.findAll({
      order: [['sort', 'ASC'], ['id', 'DESC']],
      limit: pageSize
    });
    res.json({ code: 0, data: okRows(rows.map((r) => r.toJSON())) });
  } catch (e) {
    console.error('[admin/home-display/list]', e);
    res.status(500).json({ code: 1, msg: '加载失败' });
  }
};

exports.createItem = async (req, res) => {
  try {
    await ensureTable();
    const body = req.body || {};
    const kind = String(body.kind || '').trim();
    const targetId = resolveUserId(body.target_id);
    if (!kind || !targetId) return res.status(400).json({ code: 1, msg: '参数不完整' });

    if (kind === 'worker') {
      const cid = body.community_id != null ? Number(body.community_id) : DEFAULT_COMMUNITY_ID;
      await ensureWorkerVisibleInCommunity(targetId, cid);
    }

    const dup = await HomeDisplayItem.findOne({ where: { kind, target_id: targetId } });
    if (dup) return res.status(400).json({ code: 1, msg: '已在首页展示列表中' });

    const row = await HomeDisplayItem.create({
      kind,
      target_id: targetId,
      title: body.title || '',
      description: body.description || '',
      cover: body.cover || '',
      sort: body.sort != null ? Number(body.sort) : 0,
      status: body.status != null ? (body.status ? 1 : 0) : 1,
      community_id: body.community_id != null ? Number(body.community_id) : DEFAULT_COMMUNITY_ID
    });
    res.json({ code: 0, msg: '添加成功', data: row.toJSON() });
  } catch (e) {
    console.error('[admin/home-display/create]', e);
    res.status(500).json({ code: 1, msg: '添加失败' });
  }
};

exports.updateItem = async (req, res) => {
  try {
    await ensureTable();
    const row = await HomeDisplayItem.findByPk(req.params.id);
    if (!row) return res.status(404).json({ code: 1, msg: '记录不存在' });
    const body = req.body || {};
    const patch = {};
    ['title', 'description', 'cover', 'sort', 'status', 'community_id'].forEach((k) => {
      if (body[k] !== undefined) patch[k] = body[k];
    });
    await row.update(patch);
    if (row.kind === 'worker' && patch.status === 1) {
      await ensureWorkerVisibleInCommunity(row.target_id, row.community_id || DEFAULT_COMMUNITY_ID);
    }
    res.json({ code: 0, msg: '已更新', data: row.toJSON() });
  } catch (e) {
    console.error('[admin/home-display/update]', e);
    res.status(500).json({ code: 1, msg: '更新失败' });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    await ensureTable();
    const row = await HomeDisplayItem.findByPk(req.params.id);
    if (!row) return res.status(404).json({ code: 1, msg: '记录不存在' });
    await row.destroy();
    res.json({ code: 0, msg: '已移除' });
  } catch (e) {
    console.error('[admin/home-display/delete]', e);
    res.status(500).json({ code: 1, msg: '删除失败' });
  }
};

exports.searchWorkers = async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    const whereProf = { status: 'active' };
    if (keyword) {
      whereProf[Op.or] = [
        { real_name: { [Op.like]: `%${keyword}%` } },
        { industry: { [Op.like]: `%${keyword}%` } }
      ];
    }
    const profiles = WorkerProfile
      ? await WorkerProfile.findAll({ where: whereProf, limit: 50, order: [['updated_at', 'DESC']] })
      : [];
    const uids = profiles.map((p) => p.user_id);
    const apps = uids.length
      ? await WorkerApplication.findAll({ where: { user_id: { [Op.in]: uids }, status: 'approved' } })
      : [];
    const appMap = {};
    apps.forEach((a) => { appMap[a.user_id] = a; });
    const users = uids.length
      ? await User.findAll({ where: { id: { [Op.in]: uids } }, attributes: ['id', 'nickname', 'phone'] })
      : [];
    const userMap = {};
    users.forEach((u) => { userMap[u.id] = u; });

    let list = profiles
      .filter((p) => appMap[p.user_id])
      .map((p) => {
        const u = userMap[p.user_id];
        const a = appMap[p.user_id];
        return {
          id: p.user_id,
          real_name: p.real_name || (a && a.name) || (u && u.nickname) || '',
          industry: p.industry || (a && a.industry) || '',
          phone: (u && u.phone) || (a && a.phone) || '',
          community_id: p.community_id
        };
      });

    if (list.length === 0 && keyword) {
      const appWhere = {
        status: 'approved',
        [Op.or]: [
          { name: { [Op.like]: `%${keyword}%` } },
          { phone: { [Op.like]: `%${keyword}%` } },
          { industry: { [Op.like]: `%${keyword}%` } }
        ]
      };
      const appRows = await WorkerApplication.findAll({ where: appWhere, limit: 30 });
      list = appRows.map((a) => ({
        id: a.user_id,
        real_name: a.name,
        industry: a.industry,
        phone: a.phone,
        community_id: null
      }));
    }

    res.json({ code: 0, data: list });
  } catch (e) {
    console.error('[admin/home-display/search/workers]', e);
    res.status(500).json({ code: 1, msg: '搜索失败' });
  }
};

exports.searchServices = async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    const where = {};
    if (keyword) where.title = { [Op.like]: `%${keyword}%` };
    const rows = await Service.findAll({
      where,
      attributes: ['id', 'title', 'price', 'cover_image', 'is_published'],
      limit: 50,
      order: [['id', 'DESC']]
    });
    res.json({
      code: 0,
      data: rows.map((r) => ({
        id: r.id,
        title: r.title,
        price: r.price,
        cover_image: r.cover_image
      }))
    });
  } catch (e) {
    console.error('[admin/home-display/search/services]', e);
    res.status(500).json({ code: 1, msg: '搜索失败' });
  }
};

exports.searchServiceProviders = async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim();
    const where = { status: { [Op.in]: ['active', 'approved'] } };
    if (keyword) {
      where[Op.or] = [
        { shop_name: { [Op.like]: `%${keyword}%` } },
        { contact_name: { [Op.like]: `%${keyword}%` } },
        { contact_phone: { [Op.like]: `%${keyword}%` } }
      ];
    }
    const rows = ServiceProviderProfile
      ? await ServiceProviderProfile.findAll({ where, limit: 50, order: [['id', 'DESC']] })
      : [];
    res.json({
      code: 0,
      data: rows.map((r) => ({
        id: r.id,
        shop_name: r.shop_name,
        contact_name: r.contact_name,
        phone: r.contact_phone
      }))
    });
  } catch (e) {
    console.error('[admin/home-display/search/sp]', e);
    res.status(500).json({ code: 1, msg: '搜索失败' });
  }
};

/** C 端：GET /api/v1/home-display/items */
exports.getPublicHomeItems = async (req, res) => {
  try {
    await ensureTable();
    const kind = req.query.kind ? String(req.query.kind) : null;
    const communityId = req.query.community_id != null ? parseInt(req.query.community_id, 10) : null;
    const where = { status: 1 };
    if (kind) where.kind = kind;
    if (communityId) {
      where[Op.or] = [{ community_id: null }, { community_id: communityId }];
    }
    const rows = await HomeDisplayItem.findAll({
      where,
      order: [['sort', 'ASC'], ['id', 'DESC']],
      limit: 100
    });
    res.json({ code: 0, data: { list: rows.map((r) => r.toJSON()) } });
  } catch (e) {
    console.error('[home-display/public]', e);
    res.status(500).json({ code: 1, msg: '加载失败' });
  }
};
