/**
 * 保证技工在指定小区可被 C 端 core/workers 列出
 */
const db = require('../models');
const { WorkerApplication, WorkerProfile, User } = db;
const { Op } = require('sequelize');
const { resolveUserId } = require('../utils/resolveUserId');

const DEFAULT_COMMUNITY_ID = 1;

async function ensureWorkerVisibleInCommunity(userId, communityId = DEFAULT_COMMUNITY_ID) {
  const uid = resolveUserId(userId);
  const cid = Number(communityId);
  if (!uid || !Number.isFinite(cid) || cid <= 0) return false;

  const user = await User.findByPk(uid, { attributes: ['id', 'nickname'] });
  if (!user) return false;

  let app = await WorkerApplication.findOne({
    where: { user_id: uid },
    order: [['updated_at', 'DESC']]
  });
  if (!app) {
    app = await WorkerApplication.create({
      user_id: uid,
      name: user.nickname || `用户${uid}`,
      phone: '',
      industry: '综合服务',
      status: 'approved',
      reviewed_at: new Date()
    });
  } else if (app.status !== 'approved') {
    await app.update({
      status: 'approved',
      reject_reason: '',
      reviewed_at: new Date()
    });
  }

  let prof = await WorkerProfile.findOne({
    where: { user_id: uid, status: 'active' },
    order: [['updated_at', 'DESC']]
  });
  if (!prof) {
    prof = await WorkerProfile.create({
      user_id: uid,
      community_id: cid,
      real_name: app.name || user.nickname || `用户${uid}`,
      industry: app.industry || '综合服务',
      city: app.city || '',
      resume: app.resume || '',
      work_photo_url: app.work_photo_url || '',
      status: 'active'
    });
  } else {
    const patch = {};
    if (!prof.community_id || Number(prof.community_id) !== cid) patch.community_id = cid;
    if (!prof.real_name && app.name) patch.real_name = app.name;
    if (Object.keys(patch).length) await prof.update(patch);
  }
  return true;
}

async function getHomeDisplayWorkerUserIds(communityId) {
  const { HomeDisplayItem } = db;
  if (!HomeDisplayItem) return [];
  const baseWhere = { kind: 'worker', status: 1 };
  const queryOpts = {
    attributes: ['target_id', 'sort'],
    order: [['sort', 'ASC'], ['id', 'DESC']]
  };
  try {
    const where = { ...baseWhere };
    if (communityId != null) {
      where[Op.or] = [
        { community_id: null },
        { community_id: communityId }
      ];
    }
    const rows = await HomeDisplayItem.findAll({ where, ...queryOpts });
    return rows.map((r) => resolveUserId(r.target_id)).filter(Boolean);
  } catch (e) {
    const msg = (e && (e.message || e.parent && e.parent.sqlMessage)) || '';
    if (!/community_id/i.test(String(msg))) throw e;
    const rows = await HomeDisplayItem.findAll({ where: baseWhere, ...queryOpts });
    return rows.map((r) => resolveUserId(r.target_id)).filter(Boolean);
  }
}

module.exports = {
  DEFAULT_COMMUNITY_ID,
  ensureWorkerVisibleInCommunity,
  getHomeDisplayWorkerUserIds
};
