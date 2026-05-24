const { ServiceProviderProfile } = require('../models');
const { resolveUserId } = require('./resolveUserId');

/**
 * 解析服务商档案：支持 service_provider_profiles.id（profile_id）或 users.id（user_id）
 */
async function resolveServiceProviderProfile(ref) {
  const raw = String(ref || '').trim();
  if (!raw || !/^\d+$/.test(raw)) return null;

  // 雪花 user_id 较长，避免被误当作 profile 主键
  if (raw.length > 15) {
    const uid = resolveUserId(raw);
    if (!uid) return null;
    return ServiceProviderProfile.findOne({
      where: { user_id: uid, status: 'active' },
      order: [['updated_at', 'DESC']]
    });
  }

  const byPk = await ServiceProviderProfile.findByPk(raw);
  if (byPk && byPk.status === 'active') return byPk;

  const uid = resolveUserId(raw);
  if (!uid) return null;
  return ServiceProviderProfile.findOne({
    where: { user_id: uid, status: 'active' },
    order: [['updated_at', 'DESC']]
  });
}

module.exports = { resolveServiceProviderProfile };
