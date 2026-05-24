/**
 * 订单完成：推广分佣 pending→available + 接单/商家净收入账
 */
const { MerchantShop } = require('../models');
const commissionService = require('../modules/commission/services/commission.service');
const { resolveUserId } = require('../utils/resolveUserId');

let OrderSettlement = null;

async function ensureOrderSettlementModel() {
  if (OrderSettlement) return OrderSettlement;
  const db = require('../models');
  if (db.OrderSettlement) {
    OrderSettlement = db.OrderSettlement;
    return OrderSettlement;
  }
  if (!db.sequelize) return null;
  OrderSettlement = db.sequelize.define('OrderSettlement', {
    id: { type: db.Sequelize.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    order_type: { type: db.Sequelize.STRING(32), allowNull: false },
    order_id: { type: db.Sequelize.STRING(100), allowNull: false },
    beneficiary_user_id: { type: db.Sequelize.BIGINT, allowNull: false },
    beneficiary_role: { type: db.Sequelize.STRING(32), allowNull: false },
    settlement_amount: { type: db.Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    commission_confirmed: { type: db.Sequelize.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'order_settlements',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });
  await OrderSettlement.sync();
  return OrderSettlement;
}

function calcSettlementAmount(orderRow) {
  const settle = Number(orderRow.settlement_amount || 0);
  if (settle > 0) return settle;
  const payable = Number(orderRow.payable_amount || orderRow.pay_amount || orderRow.amount || 0);
  const fee = Number(orderRow.platform_fee_amount || 0);
  if (payable > 0 && fee > 0) return Number(Math.max(payable - fee, 0).toFixed(2));
  return payable > 0 ? payable : 0;
}

async function hasSettlement(orderType, orderId, beneficiaryRole) {
  const M = await ensureOrderSettlementModel();
  if (!M) return false;
  const n = await M.count({
    where: { order_type: orderType, order_id: String(orderId), beneficiary_role: beneficiaryRole }
  });
  return n > 0;
}

async function markSettlement(orderType, orderId, beneficiaryUserId, beneficiaryRole, amount, commissionConfirmed) {
  const M = await ensureOrderSettlementModel();
  if (!M) return;
  await M.findOrCreate({
    where: {
      order_type: orderType,
      order_id: String(orderId),
      beneficiary_role: beneficiaryRole
    },
    defaults: {
      beneficiary_user_id: resolveUserId(beneficiaryUserId),
      settlement_amount: amount,
      commission_confirmed: !!commissionConfirmed
    }
  });
}

/**
 * 订单完成统一结算
 * @param {object} opts
 * @param {string} opts.orderId 订单号/id
 * @param {string} opts.orderType market|service|neighbor_assist
 * @param {string|number} [opts.earnerUserId] 接单/商家用户
 * @param {string} [opts.earnerRole] merchant|service_provider|neighbor_assist|worker
 * @param {number} opts.settlementAmount 净收入
 * @param {object} [opts.transaction]
 */
async function settleOrderComplete(opts) {
  const orderId = String(opts.orderId || '');
  const orderType = String(opts.orderType || '');
  const earnerUserId = opts.earnerUserId != null ? resolveUserId(opts.earnerUserId) : null;
  const earnerRole = opts.earnerRole ? String(opts.earnerRole) : null;
  const amount = Number(opts.settlementAmount || 0);
  const transaction = opts.transaction || null;

  if (!orderId || !orderType) return { credited: false, reason: 'missing order' };

  let commissionConfirmed = false;
  try {
    await commissionService.confirmCommission(orderId);
    commissionConfirmed = true;
  } catch (e) {
    console.warn('[orderSettlement] confirmCommission', orderId, e.message);
  }

  let credited = false;
  if (earnerUserId && earnerRole && amount > 0) {
    const already = await hasSettlement(orderType, orderId, earnerRole);
    if (!already) {
      await commissionService.creditAvailableBalance(earnerUserId, earnerRole, amount, transaction);
      await markSettlement(orderType, orderId, earnerUserId, earnerRole, amount, commissionConfirmed);
      credited = true;
    }
  } else if (commissionConfirmed) {
    await markSettlement(orderType, orderId, earnerUserId || 0, earnerRole || '_commission_only', 0, true);
  }

  return { credited, commissionConfirmed, amount, earnerUserId, earnerRole };
}

async function resolveMerchantUserId(shopId) {
  if (!shopId) return null;
  const shop = await MerchantShop.findByPk(shopId, { attributes: ['id', 'user_id'] });
  return shop && shop.user_id ? resolveUserId(shop.user_id) : null;
}

async function settleMarketOrder(orderRow, transaction) {
  const orderNo = orderRow.order_no || orderRow.orderNo;
  const merchantUserId = await resolveMerchantUserId(orderRow.shop_id);
  const amount = calcSettlementAmount(orderRow);
  return settleOrderComplete({
    orderId: orderNo,
    orderType: 'market',
    earnerUserId: merchantUserId,
    earnerRole: 'merchant',
    settlementAmount: amount,
    transaction
  });
}

async function settleServiceOrder(orderRow, transaction) {
  const spUserId = orderRow.provider_user_id || null;
  const amount = calcSettlementAmount(orderRow);
  return settleOrderComplete({
    orderId: String(orderRow.id),
    orderType: 'service',
    earnerUserId: spUserId,
    earnerRole: 'service_provider',
    settlementAmount: amount,
    transaction
  });
}

async function settleNeighborOrder(orderRow, transaction) {
  const workerUserId = orderRow.assigned_worker_id || null;
  const amount = calcSettlementAmount(orderRow);
  return settleOrderComplete({
    orderId: String(orderRow.id),
    orderType: 'neighbor_assist',
    earnerUserId: workerUserId,
    earnerRole: 'neighbor_assist',
    settlementAmount: amount,
    transaction
  });
}

module.exports = {
  calcSettlementAmount,
  settleOrderComplete,
  settleMarketOrder,
  settleServiceOrder,
  settleNeighborOrder,
  resolveMerchantUserId
};
