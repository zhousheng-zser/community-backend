#!/usr/bin/env node
/**
 * 确保 users 表存在 points 列（INT DEFAULT 0）
 * 以及各订单表存在 points_earned 列
 *
 * 用法: node backend/scripts/ensure-points-column.js
 */
'use strict';

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const db = require('../src/models');

async function run() {
  const qi = db.sequelize.getQueryInterface();

  const tables = [
    { table: 'users', column: 'points', attrs: { type: db.Sequelize.INTEGER, defaultValue: 0, allowNull: false } },
    { table: 'market_orders', column: 'points_earned', attrs: { type: db.Sequelize.INTEGER, defaultValue: 0, allowNull: false } },
    { table: 'service_orders', column: 'points_earned', attrs: { type: db.Sequelize.INTEGER, defaultValue: 0, allowNull: false } },
    { table: 'neighbor_assist_orders', column: 'points_earned', attrs: { type: db.Sequelize.INTEGER, defaultValue: 0, allowNull: false } }
  ];

  for (const { table, column, attrs } of tables) {
    try {
      const desc = await qi.describeTable(table);
      if (!desc[column]) {
        await qi.addColumn(table, column, attrs);
        console.log(`[OK] ${table}.${column} 列已添加`);
      } else {
        console.log(`[SKIP] ${table}.${column} 已存在`);
      }
    } catch (e) {
      if (e.original && e.original.code === 'ER_NO_SUCH_TABLE') {
        console.log(`[SKIP] 表 ${table} 不存在，跳过`);
      } else {
        console.error(`[ERR] ${table}.${column}: ${e.message}`);
      }
    }
  }

  await db.sequelize.close();
  console.log('\n完成');
}

run().catch(e => { console.error(e); process.exit(1); });
