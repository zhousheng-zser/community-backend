/**
 * 平台订单抽成：付款端全额 / 接单端净收
 */
const { SystemConfig } = require('../models');

const ORDER_TYPE_KEYS = {
  market: 'platform.fee_rate.market',
  service: 'platform.fee_rate.service',
  neighbor_assist: 'platform.fee_rate.neighbor_assist'
};

const DEFAULT_GLOBAL_KEY = 'platform.fee_rate';
const MAX_FEE_RATE = 0.30;

function clampRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > MAX_FEE_RATE) return MAX_FEE_RATE;
  return n;
}

async function safeConfigGet(key) {
  if (!SystemConfig) return null;
  try {
    return await SystemConfig.get(key);
  } catch (e) {
    console.warn('[platformFee] config read failed', key, e.message);
    return null;
  }
}

async function getGlobalFeeRate() {
  if (!SystemConfig) return 0.10;
  const v = await safeConfigGet(DEFAULT_GLOBAL_KEY);
  return clampRate(v != null ? v : 0.10);
}

async function getPlatformFeeRate(orderType) {
  const globalRate = await getGlobalFeeRate();
  const key = ORDER_TYPE_KEYS[String(orderType || '').toLowerCase()];
  if (!key || !SystemConfig) return globalRate;
  const specific = await safeConfigGet(key);
  if (specific == null || specific === '' || !Number.isFinite(Number(specific))) {
    return globalRate;
  }
  return clampRate(specific);
}

async function getAllPlatformFeeRates() {
  const global = await getGlobalFeeRate();
  const market = await getPlatformFeeRate('market');
  const service = await getPlatformFeeRate('service');
  const neighbor_assist = await getPlatformFeeRate('neighbor_assist');
  return {
    global,
    market,
    service,
    neighbor_assist,
    max_rate: MAX_FEE_RATE
  };
}

function calcPlatformFeeSync(payableAmount, feeRate) {
  const payable = Number(payableAmount) || 0;
  const rate = clampRate(feeRate);
  const platformFeeAmount = Number((payable * rate).toFixed(2));
  const settlementAmount = Number(Math.max(payable - platformFeeAmount, 0).toFixed(2));
  return {
    payable_amount: payable,
    platform_fee_rate: rate,
    platform_fee_amount: platformFeeAmount,
    settlement_amount: settlementAmount
  };
}

async function calcPlatformFee(payableAmount, orderType) {
  const feeRate = await getPlatformFeeRate(orderType);
  return calcPlatformFeeSync(payableAmount, feeRate);
}

async function setPlatformFeeConfig(payload) {
  if (!SystemConfig) throw new Error('SystemConfig 不可用');
  const upsert = async (key, value, desc, isPublic) => {
    const strVal = value === '' || value == null ? '' : String(value);
    const [row] = await SystemConfig.findOrCreate({
      where: { config_key: key },
      defaults: {
        config_key: key,
        config_value: strVal,
        config_type: 'decimal',
        description: desc || '',
        is_public: !!isPublic
      }
    });
    await row.update({
      config_value: strVal,
      config_type: 'decimal',
      description: desc || row.description,
      is_public: isPublic != null ? !!isPublic : row.is_public
    });
  };
  if (payload.global != null) {
    await upsert(DEFAULT_GLOBAL_KEY, clampRate(payload.global), '平台默认抽成比例', true);
  }
  if (payload.market != null) {
    await upsert(ORDER_TYPE_KEYS.market, payload.market === '' ? '' : clampRate(payload.market), '本地集市抽成', false);
  }
  if (payload.service != null) {
    await upsert(ORDER_TYPE_KEYS.service, payload.service === '' ? '' : clampRate(payload.service), '到家服务抽成', false);
  }
  if (payload.neighbor_assist != null) {
    await upsert(ORDER_TYPE_KEYS.neighbor_assist, payload.neighbor_assist === '' ? '' : clampRate(payload.neighbor_assist), '邻里帮帮抽成', false);
  }
  return getAllPlatformFeeRates();
}

/** 接单端展示价；发单人看全额 */
function displayAmountForRole(orderRow, viewerUserId, orderType) {
  const payable = Number(orderRow.amount != null ? orderRow.amount : orderRow.payable_amount || 0);
  const settlement = Number(
    orderRow.settlement_amount != null && orderRow.settlement_amount > 0
      ? orderRow.settlement_amount
      : payable
  );
  const publisherId = String(orderRow.user_id || '');
  const viewer = viewerUserId != null ? String(viewerUserId) : '';
  const isPublisher = publisherId && viewer && publisherId === viewer;
  const display = isPublisher ? payable : settlement;
  return {
    payable_amount: payable,
    settlement_amount: settlement,
    platform_fee_amount: Number(orderRow.platform_fee_amount || 0),
    platform_fee_rate: orderRow.platform_fee_rate != null ? Number(orderRow.platform_fee_rate) : null,
    display_amount: display,
    amount: String(display),
    reward_amount: String(isPublisher ? payable : settlement)
  };
}

module.exports = {
  MAX_FEE_RATE,
  getGlobalFeeRate,
  getPlatformFeeRate,
  getAllPlatformFeeRates,
  calcPlatformFee,
  calcPlatformFeeSync,
  setPlatformFeeConfig,
  displayAmountForRole
};
