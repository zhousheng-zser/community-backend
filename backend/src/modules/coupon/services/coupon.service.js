const { Op } = require('sequelize');
const db = require('../../../models');
const { CouponTemplate, CouponIssue, User } = db;

const WELCOME_TEMPLATE_CODE = 'WELCOME_100_20';
const LEGACY_WELCOME_CODES = ['WELCOME_100_10', 'WELCOME_100_20'];

let tablesReady = false;

async function ensureCouponTables() {
  if (tablesReady) return;
  await Promise.all([
    CouponTemplate && CouponTemplate.sync ? CouponTemplate.sync() : Promise.resolve(),
    CouponIssue && CouponIssue.sync ? CouponIssue.sync() : Promise.resolve()
  ]);
  tablesReady = true;
}

function generateIssueCode() {
  return 'CPN' + Date.now() + Math.random().toString(36).substring(2, 8).toUpperCase();
}

function remainCount(template) {
  const total = Number(template.total_count) || 0;
  if (total <= 0) return null;
  const issued = Number(template.issued_count) || 0;
  return Math.max(total - issued, 0);
}

function isReceiveWindowOpen(template, now = new Date()) {
  if (template.receive_from && now < new Date(template.receive_from)) return false;
  if (template.receive_to && now > new Date(template.receive_to)) return false;
  return true;
}

function isValidPeriod(template, now = new Date()) {
  if (template.valid_from && now < new Date(template.valid_from)) return false;
  if (template.valid_to && now > new Date(template.valid_to)) return false;
  return true;
}

function matchesApplyScope(template, orderType) {
  const scope = String(template.apply_scope || 'all').toLowerCase();
  if (!orderType || scope === 'all') return true;
  return scope === String(orderType).toLowerCase();
}

async function countUserUnused(userId, templateId, transaction) {
  return CouponIssue.count({
    where: { user_id: userId, template_id: templateId, status: 'unused' },
    transaction
  });
}

async function assertCanIssue(userId, template, transaction) {
  const now = new Date();
  if (!template || template.status !== 'active') {
    const err = new Error('优惠券不存在或已失效');
    err.statusCode = 404;
    throw err;
  }
  if (!isValidPeriod(template, now)) {
    const err = new Error('优惠券已过期');
    err.statusCode = 400;
    throw err;
  }
  const remain = remainCount(template);
  if (remain != null && remain <= 0) {
    const err = new Error('优惠券已领完');
    err.statusCode = 400;
    throw err;
  }
  const limit = Number(template.per_user_limit) || 1;
  const unused = await countUserUnused(userId, template.id, transaction);
  if (unused >= limit) {
    const err = new Error('已达领取上限');
    err.statusCode = 400;
    throw err;
  }
}

async function incrementIssuedCount(templateId, transaction) {
  const [affected] = await CouponTemplate.update(
    { issued_count: db.sequelize.literal('issued_count + 1') },
    {
      where: {
        id: templateId,
        [Op.or]: [
          { total_count: 0 },
          db.sequelize.where(
            db.sequelize.col('issued_count'),
            Op.lt,
            db.sequelize.col('total_count')
          )
        ]
      },
      transaction
    }
  );
  if (!affected) {
    const err = new Error('优惠券库存不足');
    err.statusCode = 400;
    throw err;
  }
}

async function issueToUser(userId, templateId, options = {}) {
  const { source = 'claim', transaction: outerTx } = options;
  const run = async (transaction) => {
    await ensureCouponTables();
    const template = await CouponTemplate.findByPk(templateId, { transaction, lock: transaction.LOCK.UPDATE });
    await assertCanIssue(userId, template, transaction);
    const issue = await CouponIssue.create({
      template_id: templateId,
      user_id: userId,
      code: generateIssueCode(),
      status: 'unused',
      issued_at: new Date(),
      issue_source: source
    }, { transaction });
    await incrementIssuedCount(templateId, transaction);
    return issue;
  };
  if (outerTx) return run(outerTx);
  return db.sequelize.transaction(run);
}

async function getOrCreateWelcomeTemplate(transaction) {
  const opts = transaction ? { transaction } : {};
  let tpl = await CouponTemplate.findOne({ where: { code: WELCOME_TEMPLATE_CODE }, ...opts });
  if (!tpl) {
    const now = new Date();
    const nextYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    tpl = await CouponTemplate.create({
      code: WELCOME_TEMPLATE_CODE,
      name: '满100减20新人券',
      type: 'amount',
      discount_amount: 20,
      threshold_amount: 100,
      total_count: 0,
      issued_count: 0,
      valid_from: now,
      valid_to: nextYear,
      status: 'active',
      issue_mode: 'auto_new_user',
      is_new_user: 1,
      apply_scope: 'all',
      per_user_limit: 1
    }, opts);
  }
  return tpl;
}

async function ensureWelcomeCoupon(userId) {
  if (!userId || !CouponTemplate || !CouponIssue) return null;
  await ensureCouponTables();
  const now = new Date();
  let templates = await CouponTemplate.findAll({
    where: {
      status: 'active',
      issue_mode: 'auto_new_user',
      is_new_user: 1
    }
  });
  if (!templates.length) {
    templates = [await getOrCreateWelcomeTemplate()];
  }
  templates = templates.filter((t) => isValidPeriod(t, now));
  if (!templates.length) return null;

  const legacyTpls = await CouponTemplate.findAll({ where: { code: LEGACY_WELCOME_CODES } });
  const legacyIds = legacyTpls.map((t) => t.id);
  if (legacyIds.length) {
    const existingAny = await CouponIssue.findOne({
      where: { user_id: userId, template_id: { [Op.in]: legacyIds } }
    });
    if (existingAny) return existingAny;
  }

  let lastIssue = null;
  for (const tpl of templates) {
    const unused = await countUserUnused(userId, tpl.id);
    const limit = Number(tpl.per_user_limit) || 1;
    if (unused >= limit) continue;
    try {
      lastIssue = await issueToUser(userId, tpl.id, { source: 'auto' });
    } catch (e) {
      if (e.statusCode === 400 && /上限|领完/.test(e.message)) continue;
      throw e;
    }
  }
  return lastIssue;
}

function mapIssueRow(i) {
  const tpl = i.CouponTemplate || {};
  const validTo = tpl.valid_to || null;
  return {
    id: i.id,
    coupon_id: i.template_id,
    code: i.code,
    coupon_name: tpl.name || '',
    coupon_money: tpl.discount_amount != null ? Number(tpl.discount_amount) : 0,
    discount_amount: tpl.discount_amount != null ? Number(tpl.discount_amount) : 0,
    threshold_amount: tpl.threshold_amount != null ? Number(tpl.threshold_amount) : 0,
    apply_scope: tpl.apply_scope || 'all',
    status: i.status,
    issued_at: i.issued_at,
    end_time: validTo,
    endTime: validTo,
    template: tpl
  };
}

function mapTemplateRow(t, extra = {}) {
  const remain = remainCount(t);
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    coupon_name: t.name,
    type: t.type,
    coupon_money: t.discount_amount,
    discount_amount: t.discount_amount,
    threshold_amount: t.threshold_amount,
    total_count: t.total_count,
    issued_count: t.issued_count,
    remain_count: remain,
    valid_from: t.valid_from,
    valid_to: t.valid_to,
    end_time: t.valid_to,
    endTime: t.valid_to,
    status: t.status,
    issue_mode: t.issue_mode || 'claim',
    per_user_limit: t.per_user_limit != null ? Number(t.per_user_limit) : 1,
    receive_from: t.receive_from,
    receive_to: t.receive_to,
    apply_scope: t.apply_scope || 'all',
    show_on_home: !!t.show_on_home,
    home_sort: t.home_sort != null ? Number(t.home_sort) : 0,
    description: t.description || '',
    is_new_user: !!t.is_new_user,
    ...extra
  };
}

async function validateCouponForOrder(userId, couponIssueId, orderAmount, transaction, orderType) {
  if (!couponIssueId) {
    return { discount: 0, issue: null, template: null, goodsAmount: orderAmount, payableAmount: orderAmount };
  }
  await ensureCouponTables();
  const amount = Number(orderAmount) || 0;
  const issue = await CouponIssue.findOne({
    where: { id: couponIssueId, user_id: userId, status: 'unused' },
    include: [{ model: CouponTemplate, as: 'CouponTemplate', required: true }],
    transaction
  });
  if (!issue || !issue.CouponTemplate) {
    const err = new Error('优惠券不可用或已使用');
    err.statusCode = 400;
    throw err;
  }
  const tpl = issue.CouponTemplate;
  if (tpl.status !== 'active') {
    const err = new Error('优惠券已失效');
    err.statusCode = 400;
    throw err;
  }
  const now = new Date();
  if (!isValidPeriod(tpl, now)) {
    const err = new Error(tpl.valid_to && now > new Date(tpl.valid_to) ? '优惠券已过期' : '优惠券未到使用时间');
    err.statusCode = 400;
    throw err;
  }
  if (orderType && !matchesApplyScope(tpl, orderType)) {
    const err = new Error('该优惠券不适用于当前订单类型');
    err.statusCode = 400;
    throw err;
  }
  const threshold = Number(tpl.threshold_amount) || 0;
  if (amount < threshold) {
    const err = new Error(`订单满${threshold}元才可使用该券`);
    err.statusCode = 400;
    throw err;
  }
  const discount = Math.min(Number(tpl.discount_amount) || 0, amount);
  const payableAmount = Math.max(Number((amount - discount).toFixed(2)), 0);
  return { discount, issue, template: tpl, goodsAmount: amount, payableAmount };
}

async function markCouponUsed(issueId, orderType, orderRef, transaction) {
  if (!issueId) return;
  await CouponIssue.update(
    {
      status: 'used',
      used_at: new Date(),
      order_type: orderType || null,
      order_ref: orderRef != null ? String(orderRef) : null
    },
    { where: { id: issueId, status: 'unused' }, transaction }
  );
}

async function releaseCouponByOrder(orderType, orderRef, transaction) {
  if (!orderRef) return;
  await CouponIssue.update(
    { status: 'unused', used_at: null, order_type: null, order_ref: null },
    {
      where: { order_type: orderType, order_ref: String(orderRef), status: 'used' },
      transaction
    }
  );
}

async function batchIssueToUsers(templateId, userIds, source = 'admin_batch') {
  const stats = { success: 0, skip: 0, fail: 0, errors: [] };
  const uniqueIds = [...new Set(userIds.map((id) => String(id)).filter(Boolean))];
  for (const uid of uniqueIds) {
    try {
      await issueToUser(uid, templateId, { source });
      stats.success += 1;
    } catch (e) {
      if (e.statusCode === 400 && /上限|已领完|领完/.test(e.message)) {
        stats.skip += 1;
      } else {
        stats.fail += 1;
        if (stats.errors.length < 20) stats.errors.push({ user_id: uid, msg: e.message });
      }
    }
  }
  return stats;
}

async function batchIssueAllUsers(templateId) {
  if (!User) {
    const err = new Error('User 模型不可用');
    err.statusCode = 500;
    throw err;
  }
  const pageSize = 500;
  let offset = 0;
  const stats = { success: 0, skip: 0, fail: 0, errors: [] };
  for (;;) {
    const rows = await User.findAll({
      attributes: ['id'],
      limit: pageSize,
      offset,
      order: [['id', 'ASC']]
    });
    if (!rows.length) break;
    const part = await batchIssueToUsers(templateId, rows.map((r) => r.id), 'admin_batch');
    stats.success += part.success;
    stats.skip += part.skip;
    stats.fail += part.fail;
    stats.errors.push(...part.errors);
    offset += pageSize;
    if (rows.length < pageSize) break;
  }
  return stats;
}

module.exports = {
  WELCOME_TEMPLATE_CODE,
  ensureCouponTables,
  ensureWelcomeCoupon,
  issueToUser,
  batchIssueToUsers,
  batchIssueAllUsers,
  mapIssueRow,
  mapTemplateRow,
  remainCount,
  isReceiveWindowOpen,
  isValidPeriod,
  matchesApplyScope,
  validateCouponForOrder,
  markCouponUsed,
  releaseCouponByOrder
};
