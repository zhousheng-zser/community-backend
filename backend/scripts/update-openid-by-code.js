#!/usr/bin/env node
/**
 * 用 wx.login 的 code 为指定手机号用户更新 openid（换 AppID 后运维用）
 *
 * 用法：
 *   node scripts/update-openid-by-code.js --phone 13800000000 --code 0d3xxx
 */
require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  override: true,
  quiet: true
});

const { resolveOpenidFromCode } = require('../src/utils/wxOpenid');
const db = require('../src/models');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--phone') out.phone = args[++i];
    else if (args[i] === '--code') out.code = args[++i];
  }
  return out;
}

async function main() {
  const { phone, code } = parseArgs();
  if (!phone || !code) {
    console.error('用法: node scripts/update-openid-by-code.js --phone <手机号> --code <wx.login code>');
    process.exit(1);
  }

  const user = await db.User.findOne({ where: { phone: String(phone).trim() } });
  if (!user) {
    console.error(`未找到手机号 ${phone}`);
    process.exit(1);
  }

  const openid = await resolveOpenidFromCode(code);
  const existing = await db.User.findOne({ where: { openid } });
  if (existing && String(existing.id) !== String(user.id)) {
    console.error(`openid 已被用户 ${existing.phone || existing.id} 占用`);
    process.exit(1);
  }

  const oldOpenid = user.openid;
  user.openid = openid;
  await user.save();

  console.log(`已更新 ${phone}`);
  console.log(`  旧 openid: ${oldOpenid || '(空)'}`);
  console.log(`  新 openid: ${openid}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.details || e.message || e);
  process.exit(1);
});
