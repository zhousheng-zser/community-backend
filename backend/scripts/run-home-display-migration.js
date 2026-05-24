/**
 * 创建 home_display_items 表（首页展示管理）
 * 用法：cd backend && node scripts/run-home-display-migration.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../src/models');

async function main() {
  await sequelize.authenticate();
  const sqlPath = path.join(__dirname, '..', 'sql', '0432_home_display_items.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await sequelize.query(sql);
  console.log('OK: home_display_items 表已就绪');
  await sequelize.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
