/**
 * 回填技工申请/档案的 user_id、community_id（按手机号关联 users）
 * 用法：cd backend && node scripts/backfill-worker-user-community.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), quiet: true });
const { Op } = require('sequelize');
const { User, WorkerApplication, WorkerProfile, sequelize } = require('../src/models');

async function main() {
  await sequelize.authenticate();
  let appFixed = 0;
  let profFixed = 0;
  let commFixed = 0;

  const apps = await WorkerApplication.findAll({
    where: { [Op.or]: [{ user_id: null }, { user_id: '' }] }
  });
  for (const app of apps) {
    if (!app.phone) continue;
    const user = await User.findOne({ where: { phone: String(app.phone) } });
    if (!user) continue;
    app.user_id = user.id;
    await app.save();
    appFixed++;
  }

  const profs = await WorkerProfile.findAll({
    where: { [Op.or]: [{ user_id: null }, { user_id: '' }] }
  });
  for (const prof of profs) {
    let user = null;
    if (prof.application_id) {
      const app = await WorkerApplication.findByPk(prof.application_id);
      if (app && app.user_id) user = await User.findByPk(app.user_id);
      else if (app && app.phone) user = await User.findOne({ where: { phone: String(app.phone) } });
    }
    if (!user && prof.phone) {
      user = await User.findOne({ where: { phone: String(prof.phone) } });
    }
    if (!user) continue;
    prof.user_id = user.id;
    if (prof.community_id == null && user.community_id != null) {
      prof.community_id = user.community_id;
      commFixed++;
    }
    await prof.save();
    profFixed++;
  }

  const activeProfs = await WorkerProfile.findAll({
    where: { status: 'active', user_id: { [Op.ne]: null }, community_id: null }
  });
  for (const prof of activeProfs) {
    const user = await User.findByPk(prof.user_id, { attributes: ['community_id'] });
    if (user && user.community_id != null) {
      prof.community_id = user.community_id;
      await prof.save();
      commFixed++;
    }
  }

  console.log('backfill done:', { appFixed, profFixed, commFixed });
  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
