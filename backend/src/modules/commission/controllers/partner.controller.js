/**
 * Partner Controller
 * Handles partner role management, downline tracking, applications
 */
const {
  PartnerRole,
  PartnerRelation,
  PartnerApplication,
  User
} = require('../../../models');
const commissionService = require('../services/commission.service');

let partnerApplicationTableReady = false;

async function ensurePartnerApplicationTable() {
  if (partnerApplicationTableReady) return;
  if (PartnerApplication && PartnerApplication.sync) {
    await PartnerApplication.sync();
  }
  partnerApplicationTableReady = true;
}

function hasActivePartnerRole(roles) {
  return (roles || []).some((r) => r.role === 'promoter' && r.status === 'active');
}

// GET /partner/me - Get current user's partner role info
exports.getMe = async (req, res) => {
  try {
    const userId = req.user.id;

    const roles = await PartnerRole.findAll({
      where: { user_id: userId, status: 'active' }
    });

    // Get downline count (users invited by this user)
    const downlineCount = await User.count({
      where: { invited_by: userId }
    });

    // Get partner chain
    const relation = await PartnerRelation.findOne({
      where: { promoter_user_id: userId, is_valid: true }
    });

    res.json({ code: 0, msg: 'ok', data: {
      user_id: userId,
      roles: roles.map(r => r.role),
      role_details: roles.map(r => ({
        role: r.role,
        status: r.status,
        approved_at: r.approved_at,
        created_at: r.created_at
      })),
      downline_count: downlineCount,
      partner_chain: relation ? {
        district_partner_user_id: relation.district_partner_user_id,
        market_partner_user_id: relation.market_partner_user_id
      } : null
    }});
  } catch (error) {
    console.error('获取合伙人信息失败:', error);
    res.status(500).json({ code: 1, msg: '获取合伙人信息失败' });
  }
};

// GET /partner/my-downlines - List users invited by current user
exports.getMyDownlines = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await User.findAndCountAll({
      where: { invited_by: userId },
      attributes: ['id', 'nickname', 'avatar_url', 'phone', 'created_at'],
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    const list = result.rows.map(u => ({
      id: u.id,
      nickname: u.nickname,
      avatar_url: u.avatar_url,
      phone: u.phone ? u.phone.substring(0, 3) + '****' + u.phone.substring(7) : '',
      created_at: u.created_at
    }));

    res.json({ code: 0, msg: 'ok', data: { list, total: result.count, page } });
  } catch (error) {
    console.error('获取下线列表失败:', error);
    res.status(500).json({ code: 1, msg: '获取下线列表失败' });
  }
};

// GET /partner/application/me — 申请状态（成为合伙人页）
exports.getApplicationMe = async (req, res) => {
  try {
    await ensurePartnerApplicationTable();
    const userId = req.user.id;
    const roles = await PartnerRole.findAll({ where: { user_id: userId } });
    const isPartner = hasActivePartnerRole(roles);

    let application = null;
    if (PartnerApplication) {
      application = await PartnerApplication.findOne({
        where: { user_id: userId },
        order: [['created_at', 'DESC']]
      });
    }

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        is_partner: isPartner,
        application: application ? application.toJSON() : null
      }
    });
  } catch (error) {
    console.error('获取合伙人申请状态失败:', error);
    res.status(500).json({ code: 1, msg: '获取申请状态失败' });
  }
};

// POST /partner/apply — 填写资料申请成为合伙人（默认推广者角色）
exports.apply = async (req, res) => {
  try {
    await ensurePartnerApplicationTable();
    const userId = req.user.id;
    const body = req.body || {};
    const role = body.role || 'promoter';
    const realName = String(body.real_name || body.realName || '').trim();
    const phone = String(body.phone || '').trim();
    const city = String(body.city || '').trim();
    const remark = String(body.remark || '').trim();

    if (!['promoter', 'district_partner', 'market_partner'].includes(role)) {
      return res.status(400).json({ code: 1, msg: '无效的角色类型' });
    }
    if (!realName) return res.status(400).json({ code: 1, msg: '请填写真实姓名' });
    if (!/^1\d{10}$/.test(phone)) return res.status(400).json({ code: 1, msg: '请输入正确手机号' });
    if (!city) return res.status(400).json({ code: 1, msg: '请填写所在城市' });

    const existingRole = await PartnerRole.findOne({
      where: { user_id: userId, role: 'promoter', status: 'active' }
    });
    if (existingRole) {
      return res.status(400).json({ code: 1, msg: '您已是合伙人' });
    }

    const pendingApp = PartnerApplication && await PartnerApplication.findOne({
      where: { user_id: userId, status: 'pending' }
    });
    if (pendingApp) {
      return res.status(400).json({ code: 1, msg: '申请审核中，请耐心等待' });
    }

    let application = null;
    if (PartnerApplication) {
      application = await PartnerApplication.create({
        user_id: userId,
        real_name: realName,
        phone,
        city,
        remark,
        role,
        status: 'pending'
      });
    }

    if (role === 'promoter') {
      const partnerRole = await commissionService.assignPromoterRole(userId);
      if (application) {
        await application.update({ status: 'approved' });
      }
      return res.json({
        code: 0,
        msg: '已成为合伙人',
        data: {
          role: partnerRole.toJSON(),
          application: application ? application.toJSON() : null
        }
      });
    }

    const partnerRole = await PartnerRole.create({
      user_id: userId,
      role,
      status: 'pending_approval',
      created_at: new Date()
    });

    res.json({ code: 0, msg: '申请已提交，等待审核', data: { role: partnerRole.toJSON(), application } });
  } catch (error) {
    console.error('合伙人申请失败:', error);
    res.status(500).json({ code: 1, msg: '申请失败' });
  }
};

// POST /partner/refresh-chain - Force re-resolve partner chain
exports.refreshChain = async (req, res) => {
  try {
    const userId = req.user.id;

    // Invalidate existing cache
    await PartnerRelation.update(
      { is_valid: false },
      { where: { promoter_user_id: userId } }
    );

    // Re-resolve
    const result = await commissionService.resolvePartnerChain(userId);

    res.json({ code: 0, msg: '合伙人链已更新', data: result });
  } catch (error) {
    console.error('刷新合伙人链失败:', error);
    res.status(500).json({ code: 1, msg: '刷新失败' });
  }
};
