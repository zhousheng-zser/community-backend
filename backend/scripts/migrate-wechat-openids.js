#!/usr/bin/env node
/**
 * 将 users.openid 从旧小程序 AppID 迁移到新 AppID（微信 changeopenid 接口）。
 *
 * 前置条件：
 * 1. 新旧小程序已绑定同一微信开放平台，且已完成帐号迁移配置（若微信侧要求）
 * 2. .env 中 WX_APPID / WX_APPSECRET 为新小程序凭证（须能换取 access_token）
 *
 * 用法：
 *   node scripts/migrate-wechat-openids.js
 *   OLD_WX_APPID=wx988faca566529d28 node scripts/migrate-wechat-openids.js --dry-run
 */
require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  override: true,
  quiet: true
});

const axios = require('axios');
const db = require('../src/models');

const OLD_APPID = process.env.OLD_WX_APPID || 'wx988faca566529d28';
const NEW_APPID = process.env.WX_APPID;
const NEW_SECRET = process.env.WX_APPSECRET;
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 100;

/** 真实微信 openid（排除 mock / phone_ 占位） */
function isMigratableOpenid(openid) {
  if (!openid || typeof openid !== 'string') return false;
  if (openid.startsWith('mock_openid_')) return false;
  if (openid.startsWith('phone_')) return false;
  return /^o[A-Za-z0-9_-]+$/.test(openid);
}

async function getAccessToken(appid, secret) {
  const { data } = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: { grant_type: 'client_credential', appid, secret }
  });
  if (data.errcode) {
    const err = new Error(data.errmsg || '获取 access_token 失败');
    err.details = data;
    throw err;
  }
  return data.access_token;
}

async function changeOpenids(accessToken, fromAppid, openidList) {
  const { data } = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/changeopenid?access_token=${accessToken}`,
    { from_appid: fromAppid, openid_list: openidList }
  );
  return data;
}

async function main() {
  if (!NEW_APPID || !NEW_SECRET) {
    console.error('请在 .env 配置新小程序 WX_APPID 与 WX_APPSECRET');
    process.exit(1);
  }

  console.log(`旧 AppID: ${OLD_APPID}`);
  console.log(`新 AppID: ${NEW_APPID}`);
  console.log(`模式: ${DRY_RUN ? 'dry-run（仅预览）' : '执行迁移'}`);

  const users = await db.User.findAll({
    attributes: ['id', 'phone', 'openid', 'nickname'],
    where: { openid: { [db.Sequelize.Op.ne]: null } }
  });

  const targets = users.filter((u) => isMigratableOpenid(u.openid));
  const skipped = users.filter((u) => u.openid && !isMigratableOpenid(u.openid));

  console.log(`总用户数（有 openid）: ${users.length}`);
  console.log(`待迁移（真实微信 openid）: ${targets.length}`);
  console.log(`跳过（mock/phone 占位）: ${skipped.length}`);

  if (!targets.length) {
    console.log('没有需要迁移的 openid');
    process.exit(0);
  }

  targets.forEach((u) => {
    console.log(`  - ${u.phone || u.nickname || u.id}: ${u.openid}`);
  });

  if (DRY_RUN) {
    console.log('\ndry-run 结束，未调用微信接口');
    process.exit(0);
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(NEW_APPID, NEW_SECRET);
    console.log('已获取新小程序 access_token');
  } catch (e) {
    console.error('无法获取新小程序 access_token，请确认 WX_APPSECRET 与新 AppID 匹配');
    console.error(e.details || e.message);
    process.exit(1);
  }

  const openidToUser = new Map(targets.map((u) => [u.openid, u]));
  const allOpenids = [...openidToUser.keys()];
  let updated = 0;

  for (let i = 0; i < allOpenids.length; i += BATCH) {
    const chunk = allOpenids.slice(i, i + BATCH);
    const result = await changeOpenids(accessToken, OLD_APPID, chunk);

    if (result.errcode && result.errcode !== 0) {
      console.error('changeopenid 失败:', JSON.stringify(result));
      process.exit(1);
    }

    for (const item of result.result_list || []) {
      const user = openidToUser.get(item.ori_openid);
      if (!user) continue;
      if (item.err_msg !== 'ok' || !item.new_openid) {
        console.warn(`跳过 ${user.phone || user.id}: ${item.err_msg || '无 new_openid'}`);
        continue;
      }
      await db.User.update(
        { openid: item.new_openid },
        { where: { id: user.id } }
      );
      console.log(`已更新 ${user.phone || user.nickname}: ${item.ori_openid} -> ${item.new_openid}`);
      updated += 1;
    }
  }

  console.log(`\n完成，共更新 ${updated} 条`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
