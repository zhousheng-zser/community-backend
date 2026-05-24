/**
 * 4-Role Commission Distribution Service
 *
 * Core logic: every paid order's commission pool (= order_amount * global_rate)
 * is split among 4 parties simultaneously. Ratios are configurable via system_configs.
 */
const {
  SystemConfig,
  PartnerRole,
  PartnerRelation,
  CommissionDistribution,
  PartnerCommissionBalance,
  User
} = require('../../../models');
const { Op } = require('sequelize');
const { resolveUserId } = require('../../../utils/resolveUserId');

const ROLE_NAMES = ['headquarters', 'promoter', 'district_partner', 'market_partner'];
const PARTNER_ROLES = ['promoter', 'district_partner', 'market_partner'];

let partnerBalanceTableReady = false;

async function ensurePartnerBalanceTable() {
  if (partnerBalanceTableReady) return;
  if (PartnerCommissionBalance && PartnerCommissionBalance.sync) {
    await PartnerCommissionBalance.sync();
  }
  partnerBalanceTableReady = true;
}

/**
 * Get all commission rate configs.
 * Returns: { globalRate, headquartersPct, marketPartnerPct, districtPartnerPct, promoterPct }
 */
async function getCommissionRates() {
  const configs = await SystemConfig.getMany([
    'commission.global_rate',
    'commission.headquarters_pct',
    'commission.market_partner_pct',
    'commission.district_partner_pct',
    'commission.promoter_pct'
  ]);

  return {
    globalRate: configs['commission.global_rate'] || 0.10,
    headquartersPct: configs['commission.headquarters_pct'] || 0.05,
    marketPartnerPct: configs['commission.market_partner_pct'] || 0.05,
    districtPartnerPct: configs['commission.district_partner_pct'] || 0.20,
    promoterPct: configs['commission.promoter_pct'] || 0.70
  };
}

/**
 * Walk the invite chain upward from a promoter to find first district_partner and market_partner.
 * Caches result in partner_relations table.
 *
 * Returns: { districtPartnerUserId, marketPartnerUserId }
 */
async function resolvePartnerChain(promoterUserId) {
  // Check cache first
  let relation = await PartnerRelation.findOne({
    where: { promoter_user_id: promoterUserId, is_valid: true }
  });

  if (relation) {
    return {
      districtPartnerUserId: relation.district_partner_user_id,
      marketPartnerUserId: relation.market_partner_user_id
    };
  }

  // Walk the invite chain upward
  let currentUserId = promoterUserId;
  let districtPartnerUserId = null;
  let marketPartnerUserId = null;

  // Walk up to 10 levels maximum to prevent infinite loops
  for (let depth = 0; depth < 10; depth++) {
    const user = await User.findByPk(currentUserId, {
      attributes: ['id', 'invited_by']
    });

    if (!user || !user.invited_by) break;
    currentUserId = user.invited_by;

    // Check if this user has the partner roles we're looking for
    if (!districtPartnerUserId || !marketPartnerUserId) {
      const roles = await PartnerRole.findAll({
        where: { user_id: currentUserId, status: 'active' }
      });

      const roleSet = new Set(roles.map(r => r.role));

      if (!districtPartnerUserId && roleSet.has('district_partner')) {
        districtPartnerUserId = currentUserId;
      }
      if (!marketPartnerUserId && roleSet.has('market_partner')) {
        marketPartnerUserId = currentUserId;
      }

      // Found both, no need to walk further
      if (districtPartnerUserId && marketPartnerUserId) break;
    }
  }

  // Cache the result
  relation = await PartnerRelation.upsert({
    promoter_user_id: promoterUserId,
    district_partner_user_id: districtPartnerUserId,
    market_partner_user_id: marketPartnerUserId,
    is_valid: true
  });

  return { districtPartnerUserId, marketPartnerUserId };
}

/**
 * Upsert a partner commission balance entry.
 * Returns the balance record.
 */
async function upsertBalance(userId, role) {
  if (!userId) return null;

  let balance = await PartnerCommissionBalance.findOne({
    where: { user_id: userId, role }
  });

  if (!balance) {
    balance = await PartnerCommissionBalance.create({
      user_id: userId,
      role,
      total_earned: 0,
      available_amount: 0,
      withdrawn_amount: 0,
      pending_amount: 0,
      frozen_amount: 0
    });
  }

  return balance;
}

/**
 * Main distribution entry: called after order payment succeeds.
 * Creates up to 4 commission_distribution records and updates balances.
 * Runs in a transaction for atomicity.
 */
async function distributeCommission(orderId, orderType, orderAmount, buyerUserId, platformFeeAmount) {
  const sequelize = SystemConfig.sequelize;

  return sequelize.transaction(async (t) => {
    const rates = await getCommissionRates();
    let pool;
    if (platformFeeAmount != null && Number(platformFeeAmount) > 0) {
      pool = Number(Number(platformFeeAmount).toFixed(2));
    } else {
      pool = Number((Number(orderAmount) * rates.globalRate).toFixed(2));
    }
    if (pool <= 0) {
      console.log(`[Commission] Zero pool for order ${orderId}, skip`);
      return [];
    }

    // Find the promoter (user who referred the buyer)
    const buyer = await User.findByPk(buyerUserId, {
      attributes: ['id', 'invited_by']
    });

    if (!buyer || !buyer.invited_by) {
      // No promoter for this buyer, skip distribution
      console.log(`[Commission] No promoter for buyer ${buyerUserId}, skipping distribution for order ${orderId}`);
      return [];
    }

    const promoterUserId = buyer.invited_by;

    // Verify promoter has active promoter role
    const promoterRole = await PartnerRole.findOne({
      where: { user_id: promoterUserId, role: 'promoter', status: 'active' },
      transaction: t
    });

    if (!promoterRole) {
      console.log(`[Commission] User ${promoterUserId} is not an active promoter, skipping for order ${orderId}`);
      return [];
    }

    // Resolve partner chain
    const { districtPartnerUserId, marketPartnerUserId } = await resolvePartnerChain(promoterUserId);

    // Define the 4-party distribution
    const distributionPlan = [
      { role: 'headquarters', pct: rates.headquartersPct, userId: null },
      { role: 'promoter', pct: rates.promoterPct, userId: promoterUserId },
      { role: 'district_partner', pct: rates.districtPartnerPct, userId: districtPartnerUserId },
      { role: 'market_partner', pct: rates.marketPartnerPct, userId: marketPartnerUserId }
    ];

    // If a partner role has no assigned user, redistribute their share to headquarters
    let unassignedPct = 0;
    distributionPlan.forEach(item => {
      if (item.role !== 'headquarters' && !item.userId) {
        unassignedPct += item.pct;
      }
    });
    // Add unassigned portion to headquarters
    const hqItem = distributionPlan.find(i => i.role === 'headquarters');
    if (unassignedPct > 0) {
      hqItem.pct += unassignedPct;
    }

    const distributions = [];

    for (const item of distributionPlan) {
      if (item.role !== 'headquarters' && !item.userId) continue;

      const commissionAmount = Number((pool * item.pct).toFixed(2));

      if (commissionAmount <= 0) continue;

      // Create commission distribution record
      const dist = await CommissionDistribution.create({
        order_id: orderId,
        order_type: orderType,
        order_amount: orderAmount,
        commission_pool: pool,
        beneficiary_user_id: item.userId,
        beneficiary_role: item.role,
        role_percentage: item.pct,
        commission_amount: commissionAmount,
        status: 'pending',
        promoter_user_id: promoterUserId,
        distributed_at: new Date()
      }, { transaction: t });

      distributions.push(dist);

      // Update beneficiary balance (not for headquarters)
      if (item.userId) {
        const balance = await upsertBalance(item.userId, item.role);
        if (balance) {
          await balance.increment({
            total_earned: commissionAmount,
            pending_amount: commissionAmount
          }, { transaction: t });
        }
      }
    }

    console.log(`[Commission] Distributed ${pool} to ${distributions.length} parties for order ${orderId}`);
    return distributions;
  });
}

/**
 * Revert commission for a cancelled/refunded order.
 */
async function revertCommission(orderId) {
  const sequelize = SystemConfig.sequelize;

  return sequelize.transaction(async (t) => {
    const distributions = await CommissionDistribution.findAll({
      where: { order_id: orderId, status: { [Op.ne]: 'refunded' } },
      transaction: t
    });

    for (const dist of distributions) {
      const amount = Number(dist.commission_amount);
      if (amount <= 0) continue;

      // Mark as refunded
      await dist.update({ status: 'refunded' }, { transaction: t });

      // Deduct from beneficiary balance
      if (dist.beneficiary_user_id) {
        const balance = await PartnerCommissionBalance.findOne({
          where: { user_id: dist.beneficiary_user_id, role: dist.beneficiary_role },
          transaction: t
        });

        if (balance) {
          // Don't let balance go negative
          const deductPending = Math.min(Number(balance.pending_amount), amount);
          const deductAvailable = Math.min(Number(balance.available_amount), amount - deductPending);

          await balance.increment({
            total_earned: -amount,
            pending_amount: -deductPending,
            available_amount: -deductAvailable
          }, { transaction: t });
        }
      }
    }

    console.log(`[Commission] Reverted ${distributions.length} commission records for order ${orderId}`);
    return distributions;
  });
}

/**
 * Transition commission from pending to available (after order completion confirmation).
 */
async function confirmCommission(orderId) {
  const sequelize = SystemConfig.sequelize;

  return sequelize.transaction(async (t) => {
    const distributions = await CommissionDistribution.findAll({
      where: { order_id: orderId, status: 'pending' },
      transaction: t
    });

    for (const dist of distributions) {
      const amount = Number(dist.commission_amount);
      if (amount <= 0) continue;

      // Mark as available
      await dist.update({ status: 'available', settled_at: new Date() }, { transaction: t });

      // Transition balance from pending to available
      if (dist.beneficiary_user_id) {
        const balance = await PartnerCommissionBalance.findOne({
          where: { user_id: dist.beneficiary_user_id, role: dist.beneficiary_role },
          transaction: t
        });

        if (balance) {
          await balance.increment({
            pending_amount: -Math.min(Number(balance.pending_amount), amount),
            available_amount: amount
          }, { transaction: t });
        }
      }
    }

    console.log(`[Commission] Confirmed ${distributions.length} pending commissions for order ${orderId}`);
    return distributions;
  });
}

/**
 * Credit available balance for a user role (e.g. neighbor assist helper income).
 */
async function creditAvailableBalance(userId, role, amount, transaction) {
  const uid = resolveUserId(userId);
  const amt = Number(amount);
  if (!uid || !role || !(amt > 0)) return null;

  await ensurePartnerBalanceTable();

  let balance = await PartnerCommissionBalance.findOne({
    where: { user_id: uid, role },
    transaction
  });

  if (!balance) {
    balance = await PartnerCommissionBalance.create({
      user_id: uid,
      role,
      total_earned: amt,
      available_amount: amt,
      withdrawn_amount: 0,
      pending_amount: 0,
      frozen_amount: 0
    }, { transaction });
  } else {
    await balance.increment({
      available_amount: amt,
      total_earned: amt
    }, { transaction });
  }

  return balance;
}

/**
 * Get a user's total commission balance across all their roles.
 */
async function getUserBalance(userId) {
  const uid = resolveUserId(userId);
  if (!uid) {
    return {
      total_earned: 0,
      available_amount: 0,
      withdrawn_amount: 0,
      pending_amount: 0,
      frozen_amount: 0,
      roles: []
    };
  }
  await ensurePartnerBalanceTable();
  const balances = await PartnerCommissionBalance.findAll({
    where: { user_id: uid }
  });

  const summary = {
    total_earned: 0,
    available_amount: 0,
    withdrawn_amount: 0,
    pending_amount: 0,
    frozen_amount: 0,
    roles: []
  };

  for (const b of balances) {
    summary.total_earned += Number(b.total_earned);
    summary.available_amount += Number(b.available_amount);
    summary.withdrawn_amount += Number(b.withdrawn_amount);
    summary.pending_amount += Number(b.pending_amount);
    summary.frozen_amount += Number(b.frozen_amount);

    summary.roles.push({
      role: b.role,
      total_earned: Number(b.total_earned),
      available_amount: Number(b.available_amount),
      withdrawn_amount: Number(b.withdrawn_amount),
      pending_amount: Number(b.pending_amount),
      frozen_amount: Number(b.frozen_amount)
    });
  }

  // Round all values
  Object.keys(summary).forEach(k => {
    if (typeof summary[k] === 'number') {
      summary[k] = Number(summary[k].toFixed(2));
    }
  });

  return summary;
}

/**
 * Assign promoter role to a user (auto-promotion when they successfully refer a purchase).
 */
async function assignPromoterRole(userId) {
  const existing = await PartnerRole.findOne({
    where: { user_id: userId, role: 'promoter' }
  });

  if (existing) return existing;

  const role = await PartnerRole.create({
    user_id: userId,
    role: 'promoter',
    status: 'active',
    approved_at: new Date()
  });

  // Invalidate cached relations if they had any pending
  await PartnerRelation.update(
    { is_valid: false },
    { where: { promoter_user_id: userId } }
  );

  return role;
}

/**
 * 从指定角色余额提现
 */
async function withdrawFromRole(userId, role, amount) {
  const uid = resolveUserId(userId);
  const amt = Number(amount);
  if (!uid || !role || !(amt > 0)) throw new Error('无效提现参数');

  await ensurePartnerBalanceTable();
  const balance = await PartnerCommissionBalance.findOne({ where: { user_id: uid, role } });
  if (!balance || Number(balance.available_amount) < amt) {
    throw new Error('可提现金额不足');
  }

  const sequelize = PartnerCommissionBalance.sequelize;
  await sequelize.transaction(async (t) => {
    await balance.increment({ available_amount: -amt, withdrawn_amount: amt }, { transaction: t });
  });
  return balance;
}

module.exports = {
  getCommissionRates,
  resolvePartnerChain,
  distributeCommission,
  revertCommission,
  confirmCommission,
  creditAvailableBalance,
  getUserBalance,
  assignPromoterRole,
  withdrawFromRole
};
