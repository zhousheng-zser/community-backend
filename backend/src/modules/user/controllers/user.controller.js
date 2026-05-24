const { User, CommunityStewardApplication } = require('../../../models');
const { MerchantShop } = require('../../../models');
const couponService = require('../../coupon/services/coupon.service');
const crypto = require('crypto');

const ok = (res, data, msg = 'ok') => res.json({ code: 0, msg, data });
const fail = (res, msg, statusCode = 400) => res.status(statusCode).json({ code: 1, msg });

// GET /user/profile
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user && req.user.id ? Number(req.user.id) : 0;
    if (!userId) return fail(res, '未登录', 401);

    try {
      await couponService.ensureWelcomeCoupon(userId);
    } catch (e) {
      console.warn('[user/profile] ensureWelcomeCoupon', e.message);
    }

    // 优先从本地 User 表查询
    let user = null;
    try {
      user = await User.findByPk(userId, {
        attributes: ['id', 'nickname', 'userName', 'name', 'avatar_url', 'avatarUrl', 'avatar',
          'phone', 'userMobile', 'mobile', 'role', 'roles', 'community_id', 'communityId',
          'worker_status', 'workerStatus', 'points', 'created_at', 'updated_at']
      });
    } catch (e) {
      // User 表可能由主后端管理，本地缺失则跳过
    }

    // 基础用户信息（从 JWT token 中回退）
    const baseUser = req.user || {};
    const result = {
      id: userId,
      nickname: user && (user.nickname || user.userName || user.name) ? (user.nickname || user.userName || user.name) : (baseUser.nickname || baseUser.name || ''),
      userName: user && (user.nickname || user.userName || user.name) ? (user.nickname || user.userName || user.name) : (baseUser.nickname || baseUser.name || ''),
      name: user && (user.nickname || user.userName || user.name) ? (user.nickname || user.userName || user.name) : (baseUser.nickname || baseUser.name || ''),
      avatar_url: user && (user.avatar_url || user.avatarUrl || user.avatar) ? (user.avatar_url || user.avatarUrl || user.avatar) : (baseUser.avatar_url || baseUser.avatar || ''),
      avatarUrl: user && (user.avatar_url || user.avatarUrl || user.avatar) ? (user.avatar_url || user.avatarUrl || user.avatar) : (baseUser.avatar_url || baseUser.avatar || ''),
      phone: user && (user.phone || user.userMobile || user.mobile) ? (user.phone || user.userMobile || user.mobile) : (baseUser.phone || baseUser.mobile || ''),
      userMobile: user && (user.phone || user.userMobile || user.mobile) ? (user.phone || user.userMobile || user.mobile) : (baseUser.phone || baseUser.mobile || ''),
      role: user && user.role ? user.role : (baseUser.role || 'user'),
      roles: user && user.roles ? user.roles : (baseUser.roles || [baseUser.role || 'user']),
      community_id: user && (user.community_id != null ? user.community_id : user.communityId) ? (user.community_id != null ? user.community_id : user.communityId) : (baseUser.community_id || baseUser.communityId || null),
      communityId: user && (user.community_id != null ? user.community_id : user.communityId) ? (user.community_id != null ? user.community_id : user.communityId) : (baseUser.community_id || baseUser.communityId || null),
      worker_status: user && (user.worker_status || user.workerStatus) ? (user.worker_status || user.workerStatus) : (baseUser.worker_status || baseUser.workerStatus || ''),
      workerStatus: user && (user.worker_status || user.workerStatus) ? (user.worker_status || user.workerStatus) : (baseUser.worker_status || baseUser.workerStatus || ''),
      points: user && user.points != null ? Number(user.points) : (baseUser.points || 0)
    };

    // 查询集市商家店铺信息
    try {
      const shop = await MerchantShop.findOne({
        where: { user_id: userId },
        order: [['created_at', 'DESC']]
      });
      if (shop) {
        result.merchant_status = shop.status;
        result.merchantStatus = shop.status;
        result.shop_id = shop.id;
        result.shopId = shop.id;
        result.shop_name = shop.name;
        result.shopName = shop.name;
        result.shop_status = shop.status;
        result.shopStatus = shop.status;
      } else {
        result.merchant_status = '';
        result.merchantStatus = '';
        result.shop_id = null;
        result.shopId = null;
        result.shop_name = '';
        result.shopName = '';
      }
    } catch (e) {
      result.merchant_status = '';
      result.merchantStatus = '';
      result.shop_id = null;
      result.shopId = null;
    }

    try {
      if (CommunityStewardApplication) {
        const stewardApp = await CommunityStewardApplication.findOne({ where: { user_id: userId } });
        const st = stewardApp ? stewardApp.status : '';
        result.steward_status = st === 'approved' ? 'approved' : (st || '');
        result.stewardStatus = result.steward_status;
      } else {
        result.steward_status = '';
        result.stewardStatus = '';
      }
    } catch (e) {
      result.steward_status = '';
      result.stewardStatus = '';
    }

    ok(res, result);
  } catch (err) {
    console.error('[user/profile]', err);
    fail(res, '获取用户信息失败', 500);
  }
};

// PATCH /user/profile
exports.updateProfile = async (req, res) => {
  res.status(501).json({ code: 1, msg: '由主后端实现' });
};

// GET /user/addresses
exports.getAddresses = async (req, res) => {
  res.status(501).json({ code: 1, msg: '由主后端实现' });
};

// POST /user/addresses
exports.addAddress = async (req, res) => {
  res.status(501).json({ code: 1, msg: '由主后端实现' });
};

// POST /user/addresses/:id
exports.updateAddress = async (req, res) => {
  res.status(501).json({ code: 1, msg: '由主后端实现' });
};

// DELETE /user/addresses/:id
exports.deleteAddress = async (req, res) => {
  res.status(501).json({ code: 1, msg: '由主后端实现' });
};

// GET /user/invite-code
exports.getInviteCode = async (req, res) => {
  try {
    const userId = req.user && req.user.id ? Number(req.user.id) : 0;
    if (!userId) return fail(res, '未登录', 401);

    const user = await User.findByPk(userId);
    if (!user) return fail(res, '用户不存在', 404);

    let code = user.invite_code;
    if (!code) {
      code = crypto.randomBytes(3).toString('hex').toUpperCase();
      const existing = await User.findOne({ where: { invite_code: code } });
      if (existing) code = userId.toString(36).toUpperCase() + code.slice(0, 3);
      await user.update({ invite_code: code });
    }

    const inviteeCount = await User.count({ where: { invited_by: userId } });
    let inviterNickname = null;
    if (user.invited_by) {
      const inviter = await User.findByPk(user.invited_by, { attributes: ['nickname', 'userName', 'name'] });
      if (inviter) inviterNickname = inviter.nickname || inviter.userName || inviter.name;
    }

    ok(res, {
      invite_code: code,
      invitee_count: inviteeCount,
      invited_by: user.invited_by || null,
      inviter_nickname: inviterNickname,
      inviter: user.invited_by ? { nickname: inviterNickname } : null
    });
  } catch (err) {
    console.error('[user/invite-code]', err);
    fail(res, '获取邀请码失败', 500);
  }
};

// POST /user/bind-inviter
exports.bindInviter = async (req, res) => {
  try {
    const userId = req.user && req.user.id ? Number(req.user.id) : 0;
    if (!userId) return fail(res, '未登录', 401);

    const { invite_code } = req.body;
    if (!invite_code) return fail(res, '请输入邀请码');

    const user = await User.findByPk(userId);
    if (!user) return fail(res, '用户不存在', 404);
    if (user.invited_by) return fail(res, '已绑定邀请人，不可重复绑定');

    const inviter = await User.findOne({ where: { invite_code: String(invite_code).trim() } });
    if (!inviter) return fail(res, '邀请码无效');
    if (inviter.id === userId) return fail(res, '不能邀请自己');

    await user.update({ invited_by: inviter.id });

    const commissionService = require('../../commission/services/commission.service');
    try {
      await commissionService.assignPromoterRole(inviter.id);
    } catch (e) {
      console.warn('[bind-inviter] auto-assign promoter role failed:', e.message);
    }

    ok(res, {
      inviter_id: inviter.id,
      inviter_nickname: inviter.nickname || inviter.userName || inviter.name || '',
      inviter: { nickname: inviter.nickname || inviter.userName || inviter.name || '' }
    }, '绑定成功');
  } catch (err) {
    console.error('[user/bind-inviter]', err);
    fail(res, '绑定邀请人失败', 500);
  }
};

// GET /user/invitees
exports.getInvitees = async (req, res) => {
  try {
    const userId = req.user && req.user.id ? Number(req.user.id) : 0;
    if (!userId) return fail(res, '未登录', 401);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await User.findAndCountAll({
      where: { invited_by: userId },
      attributes: ['id', 'nickname', 'userName', 'name', 'avatar_url', 'avatarUrl', 'phone', 'created_at'],
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    const list = result.rows.map(u => ({
      id: u.id,
      nickname: u.nickname || u.userName || u.name || '',
      avatar_url: u.avatar_url || u.avatarUrl || '',
      created_at: u.created_at
    }));

    ok(res, { list, total: result.count, page });
  } catch (err) {
    console.error('[user/invitees]', err);
    fail(res, '获取邀请列表失败', 500);
  }
};

// ─── 浏览足迹 ────────────────────────────────────────────────────────────────

const { BrowseFootprint } = require('../../../models');

// POST /user/footprints - 记录一条足迹
exports.recordFootprint = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);
    const { kind, dedupe_key, title, cover, url } = req.body || {};
    if (!kind || !dedupe_key || !url) return fail(res, '参数不完整');

    const [row] = await BrowseFootprint.upsert({
      user_id: userId,
      kind,
      dedupe_key: String(dedupe_key).slice(0, 128),
      title: String(title || '').slice(0, 200),
      cover: String(cover || '').slice(0, 500),
      url: String(url).slice(0, 500)
    });

    ok(res, { id: row.id });
  } catch (err) {
    console.error('[user/footprints] record', err);
    fail(res, '记录足迹失败', 500);
  }
};

// POST /user/footprints/batch - 批量上传足迹（本地→后端同步）
exports.batchFootprints = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);
    const { list } = req.body || {};
    if (!Array.isArray(list) || !list.length) return fail(res, '空列表');

    const rows = list.slice(0, 50).map(item => ({
      user_id: userId,
      kind: String(item.kind || '').slice(0, 32),
      dedupe_key: String(item.dedupe_key || item.dedupeKey || '').slice(0, 128),
      title: String(item.title || '').slice(0, 200),
      cover: String(item.cover || '').slice(0, 500),
      url: String(item.url || '').slice(0, 500)
    })).filter(r => r.kind && r.dedupe_key && r.url);

    if (rows.length) {
      await BrowseFootprint.bulkCreate(rows, {
        updateOnDuplicate: ['title', 'cover', 'url', 'updated_at']
      });
    }

    ok(res, { synced: rows.length });
  } catch (err) {
    console.error('[user/footprints] batch', err);
    fail(res, '同步足迹失败', 500);
  }
};

// GET /user/footprints - 获取足迹列表
exports.getFootprints = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = (page - 1) * limit;

    const result = await BrowseFootprint.findAndCountAll({
      where: { user_id: userId },
      order: [['updated_at', 'DESC']],
      limit,
      offset,
      attributes: ['id', 'kind', 'dedupe_key', 'title', 'cover', 'url', 'updated_at']
    });

    const list = result.rows.map(r => ({
      kind: r.kind,
      dedupeKey: r.dedupe_key,
      title: r.title,
      cover: r.cover,
      url: r.url,
      t: new Date(r.updated_at).getTime()
    }));

    ok(res, { list, total: result.count, page });
  } catch (err) {
    console.error('[user/footprints] get', err);
    fail(res, '获取足迹失败', 500);
  }
};

// DELETE /user/footprints - 清空足迹
exports.clearFootprints = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);
    await BrowseFootprint.destroy({ where: { user_id: userId } });
    ok(res, null, '已清空');
  } catch (err) {
    console.error('[user/footprints] clear', err);
    fail(res, '清空足迹失败', 500);
  }
};

// ─── 服务/服务商收藏 ─────────────────────────────────────────────────────────

const { ServiceFavorite } = require('../../../models');

// POST /user/service-favorites - 添加收藏
exports.addServiceFav = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);
    const { kind, target_id, title, cover, price, url } = req.body || {};
    if (!kind || !target_id || !url) return fail(res, '参数不完整');

    const [row] = await ServiceFavorite.upsert({
      user_id: userId,
      kind: String(kind).slice(0, 32),
      target_id: Number(target_id),
      title: String(title || '').slice(0, 200),
      cover: String(cover || '').slice(0, 500),
      price: String(price || '').slice(0, 32),
      url: String(url).slice(0, 500)
    });

    ok(res, { id: row.id });
  } catch (err) {
    console.error('[user/service-favorites] add', err);
    fail(res, '收藏失败', 500);
  }
};

// DELETE /user/service-favorites - 取消收藏
exports.removeServiceFav = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);
    const { kind, target_id } = req.body || {};
    if (!kind || !target_id) return fail(res, '参数不完整');

    await ServiceFavorite.destroy({
      where: { user_id: userId, kind, target_id: Number(target_id) }
    });
    ok(res, null, '已取消收藏');
  } catch (err) {
    console.error('[user/service-favorites] remove', err);
    fail(res, '取消收藏失败', 500);
  }
};

// GET /user/service-favorites - 获取列表
exports.getServiceFavs = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);

    const kind = req.query.kind || null;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const where = { user_id: userId };
    if (kind) where.kind = kind;

    const result = await ServiceFavorite.findAndCountAll({
      where,
      order: [['updated_at', 'DESC']],
      limit,
      offset,
      attributes: ['id', 'kind', 'target_id', 'title', 'cover', 'price', 'url', 'updated_at']
    });

    const list = result.rows.map(r => ({
      kind: r.kind,
      id: r.target_id,
      dedupeKey: `${r.kind}:${r.target_id}`,
      title: r.title,
      cover: r.cover,
      price: r.price,
      url: r.url,
      t: new Date(r.updated_at).getTime()
    }));

    ok(res, { list, total: result.count, page });
  } catch (err) {
    console.error('[user/service-favorites] list', err);
    fail(res, '获取收藏失败', 500);
  }
};

// POST /user/service-favorites/batch - 批量同步（本地→后端）
exports.batchServiceFavs = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);
    const { list } = req.body || {};
    if (!Array.isArray(list) || !list.length) return fail(res, '空列表');

    const rows = list.slice(0, 200).map(item => ({
      user_id: userId,
      kind: String(item.kind || '').slice(0, 32),
      target_id: Number(item.id || item.target_id || 0),
      title: String(item.title || '').slice(0, 200),
      cover: String(item.cover || '').slice(0, 500),
      price: String(item.price || '').slice(0, 32),
      url: String(item.url || '').slice(0, 500)
    })).filter(r => r.kind && r.target_id && r.url);

    if (rows.length) {
      await ServiceFavorite.bulkCreate(rows, {
        updateOnDuplicate: ['title', 'cover', 'price', 'url', 'updated_at']
      });
    }
    ok(res, { synced: rows.length });
  } catch (err) {
    console.error('[user/service-favorites] batch', err);
    fail(res, '同步失败', 500);
  }
};

// GET /user/service-favorites/check - 检查是否已收藏
exports.checkServiceFav = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return fail(res, '未登录', 401);
    const { kind, target_id } = req.query;
    if (!kind || !target_id) return fail(res, '参数不完整');

    const row = await ServiceFavorite.findOne({
      where: { user_id: userId, kind, target_id: Number(target_id) }
    });
    ok(res, { favorited: !!row });
  } catch (err) {
    console.error('[user/service-favorites] check', err);
    fail(res, '查询失败', 500);
  }
};

// ========== 用户社区绑定管理 ==========

const { UserCommunityBinding, Community } = require('../../../models');

// GET /user/community-bindings - 获取用户绑定列表
exports.getUserCommunityBindings = async (req, res) => {
  try {
    const userId = req.user && req.user.id ? String(req.user.id) : null;
    if (!userId) return fail(res, '未登录', 401);

    // 获取用户当前选用的小区
    const user = await User.findByPk(userId, {
      attributes: ['id', 'community_id']
    });
    if (!user) return fail(res, '用户不存在', 404);

    // 获取用户绑定的所有小区
    const bindings = await UserCommunityBinding.findAll({
      where: { user_id: userId },
      include: [{
        model: Community,
        as: 'community',
        attributes: ['id', 'name', 'address', 'city', 'district', 'latitude', 'longitude', 'status']
      }],
      order: [['created_at', 'ASC']]
    });

    const list = bindings.map(binding => {
      const community = binding.community;
      return {
        community_id: community.id,
        name: community.name,
        address: community.address,
        city: community.city,
        district: community.district,
        latitude: community.latitude,
        longitude: community.longitude,
        is_active: user.community_id === community.id
      };
    });

    ok(res, {
      list,
      active_community_id: user.community_id
    });
  } catch (err) {
    console.error('[user/community-bindings] get', err);
    fail(res, '获取绑定列表失败', 500);
  }
};

// POST /user/community-bindings - 绑定小区
exports.bindCommunity = async (req, res) => {
  try {
    const userId = req.user && req.user.id ? String(req.user.id) : null;
    if (!userId) return fail(res, '未登录', 401);

    const { community_id } = req.body;
    if (!community_id || !Number.isFinite(parseInt(community_id, 10))) {
      return fail(res, '无效的小区 ID');
    }

    const cid = parseInt(community_id, 10);

    // 检查小区是否存在且为 active
    const community = await Community.findByPk(cid, {
      attributes: ['id', 'status']
    });
    if (!community || community.status !== 'active') {
      return fail(res, '小区不存在或已停用');
    }

    // 检查是否已绑定
    const existingBinding = await UserCommunityBinding.findOne({
      where: { user_id: userId, community_id: cid }
    });
    if (existingBinding) {
      return fail(res, '已绑定该小区', 409);
    }

    // 检查绑定数量是否已满（最多 3 个）
    const bindingCount = await UserCommunityBinding.count({
      where: { user_id: userId }
    });
    if (bindingCount >= 3) {
      return fail(res, '最多绑定 3 个小区');
    }

    // 创建绑定
    const binding = await UserCommunityBinding.create({
      user_id: userId,
      community_id: cid
    });

    // 如果用户没有当前选用小区，自动设置
    const user = await User.findByPk(userId);
    if (!user.community_id) {
      user.community_id = cid;
      await user.save();
    }

    ok(res, {
      binding_id: binding.id,
      community_id: cid
    }, '绑定成功');
  } catch (err) {
    console.error('[user/community-bindings] bind', err);
    fail(res, '绑定失败', 500);
  }
};

// DELETE /user/community-bindings/:communityId - 解绑小区
exports.unbindCommunity = async (req, res) => {
  try {
    const userId = req.user && req.user.id ? String(req.user.id) : null;
    if (!userId) return fail(res, '未登录', 401);

    const communityId = parseInt(req.params.communityId, 10);
    if (!Number.isFinite(communityId) || communityId <= 0) {
      return fail(res, '无效的小区 ID');
    }

    // 查找绑定记录
    const binding = await UserCommunityBinding.findOne({
      where: { user_id: userId, community_id: communityId }
    });
    if (!binding) {
      return fail(res, '未绑定该小区', 404);
    }

    // 删除绑定
    await binding.destroy();

    // 如果解绑的是当前选用小区，需要更新用户当前选用
    const user = await User.findByPk(userId);
    if (user.community_id === communityId) {
      // 查找剩余绑定
      const remainingBinding = await UserCommunityBinding.findOne({
        where: { user_id: userId },
        order: [['created_at', 'ASC']]
      });
      user.community_id = remainingBinding ? remainingBinding.community_id : null;
      await user.save();
    }

    ok(res, null, '解绑成功');
  } catch (err) {
    console.error('[user/community-bindings] unbind', err);
    fail(res, '解绑失败', 500);
  }
};

// PATCH /user/community-bindings/active - 切换当前选用小区
exports.switchActiveCommunity = async (req, res) => {
  try {
    const userId = req.user && req.user.id ? String(req.user.id) : null;
    if (!userId) return fail(res, '未登录', 401);

    const { community_id } = req.body;
    if (!community_id || !Number.isFinite(parseInt(community_id, 10))) {
      return fail(res, '无效的小区 ID');
    }

    const cid = parseInt(community_id, 10);

    // 检查是否已绑定该小区
    const binding = await UserCommunityBinding.findOne({
      where: { user_id: userId, community_id: cid }
    });
    if (!binding) {
      return fail(res, '未绑定该小区');
    }

    // 更新用户当前选用小区
    const user = await User.findByPk(userId);
    if (!user) return fail(res, '用户不存在', 404);

    user.community_id = cid;
    await user.save();

    ok(res, { community_id: cid }, '切换成功');
  } catch (err) {
    console.error('[user/community-bindings] switch', err);
    fail(res, '切换失败', 500);
  }
};
