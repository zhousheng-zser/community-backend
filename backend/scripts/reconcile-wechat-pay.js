#!/usr/bin/env node
/**
 * 主动向微信查单并补写本地支付/订单状态（回调验签失败时的对账补救）
 * 用法: node scripts/reconcile-wechat-pay.js [--out-trade-no xxx] [--order-no MK...] [--all-created]
 */
require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
  override: true,
  quiet: true
});

const db = require('../src/models');
const wechat = require('../src/utils/wechatPayV3');
const { MarketOrder, MarketPayTransaction } = db;
const orderPoints = require('../src/services/orderPoints.service');
let commissionService = null;
try {
  commissionService = require('../modules/commission/services/commission.service');
} catch (e) { /* optional */ }

async function applyMarketOrderPaidSideEffects(order) {
  try {
    await orderPoints.grantPointsOnOrderPaid(MarketOrder, order, null);
  } catch (pe) {
    console.warn('[reconcile/points]', pe.message);
  }
  if (!commissionService) return;
  try {
    const payAmount = Number(order.payable_amount || 0);
    const pool = Number(order.platform_fee_amount || 0);
    if (payAmount > 0 && pool > 0) {
      await commissionService.distributeCommission(order.order_no, 'market', payAmount, order.user_id, pool);
    } else if (payAmount > 0) {
      await commissionService.distributeCommission(order.order_no, 'market', payAmount, order.user_id);
    }
  } catch (ce) {
    console.warn('[reconcile/commission]', ce.message);
  }
}

async function reconcileOne(tx) {
  const wx = await wechat.queryJsapiOrderByOutTradeNo(tx.out_trade_no);
  if (wx.trade_state !== 'SUCCESS') {
    console.log(`跳过 ${tx.out_trade_no}: trade_state=${wx.trade_state}`);
    return false;
  }

  const paidAt = wx.success_time ? new Date(wx.success_time) : new Date();
  if (tx.pay_status !== 'success') {
    tx.pay_status = 'success';
    tx.transaction_id = wx.transaction_id || null;
    tx.paid_at = paidAt;
    tx.notify_raw = { source: 'reconcile-wechat-pay', wx };
    tx.notify_count = (tx.notify_count || 0) + 1;
    tx.last_notify_at = new Date();
    await tx.save();
  }

  const order = await MarketOrder.findOne({ where: { order_no: tx.order_no } });
  if (order && order.pay_status !== 'paid') {
    order.pay_status = 'paid';
    order.order_status = 'pending_accept';
    order.paid_at = paidAt;
    await order.save();
    await applyMarketOrderPaidSideEffects(order);
  }

  console.log(`已补单 ${tx.order_no} / ${tx.out_trade_no} -> ${wx.transaction_id}`);
  return true;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out-trade-no') out.outTradeNo = args[++i];
    else if (args[i] === '--order-no') out.orderNo = args[++i];
    else if (args[i] === '--all-created') out.allCreated = true;
  }
  return out;
}

async function main() {
  const { outTradeNo, orderNo, allCreated } = parseArgs();
  let txs = [];
  if (outTradeNo) {
    const tx = await MarketPayTransaction.findOne({ where: { out_trade_no: outTradeNo } });
    if (!tx) throw new Error(`未找到 out_trade_no=${outTradeNo}`);
    txs = [tx];
  } else if (orderNo) {
    const tx = await MarketPayTransaction.findOne({
      where: { order_no: orderNo },
      order: [['created_at', 'DESC']]
    });
    if (!tx) throw new Error(`未找到 order_no=${orderNo}`);
    txs = [tx];
  } else if (allCreated) {
    txs = await MarketPayTransaction.findAll({ where: { pay_status: 'created' }, order: [['created_at', 'DESC']] });
  } else {
    console.error('用法: node scripts/reconcile-wechat-pay.js --order-no MK... | --out-trade-no ... | --all-created');
    process.exit(1);
  }

  let ok = 0;
  for (const tx of txs) {
    try {
      if (await reconcileOne(tx)) ok += 1;
    } catch (e) {
      console.error(`失败 ${tx.out_trade_no}:`, e.message || e);
    }
  }
  console.log(`完成，补单 ${ok}/${txs.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
