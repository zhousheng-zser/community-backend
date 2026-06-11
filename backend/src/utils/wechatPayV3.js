/**
 * 微信支付 API v3（JSAPI 统一下单、调起参数、回调验签与 resource 解密）
 * 文档：https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_5_1.shtml
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE = 'https://api.mch.weixin.qq.com';
const JSAPI_PATH = '/v3/pay/transactions/jsapi';
const CERTS_PATH = '/v3/certificates';

let platformCertCache = { serialToPem: {}, fetchedAt: 0 };
const CERT_CACHE_MS = 12 * 60 * 60 * 1000;

function envAppId() {
  return process.env.WX_PAY_APPID || process.env.WX_APPID || process.env.WECHAT_APPID;
}

function envMchId() {
  return process.env.WX_PAY_MCHID || process.env.WX_MCH_ID;
}

function envSerialNo() {
  return process.env.WX_PAY_SERIAL_NO || process.env.WX_MCH_SERIAL_NO;
}

function envApiV3Key() {
  return process.env.WX_PAY_API_V3_KEY || process.env.WX_API_V3_KEY;
}

function loadPrivateKeyPem() {
  const raw = process.env.WX_PAY_PRIVATE_KEY;
  const keyPath = process.env.WX_PAY_PRIVATE_KEY_PATH;
  if (raw && String(raw).trim()) {
    return raw.replace(/\\n/g, '\n');
  }
  if (keyPath) {
    const p = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);
    return fs.readFileSync(p, 'utf8');
  }
  return null;
}

function isValidPublicKeyPem(pem) {
  if (!pem || typeof pem !== 'string') return false;
  const trimmed = pem.trim();
  if (!trimmed.includes('BEGIN PUBLIC KEY')) return false;
  if (/在此粘贴|placeholder|replace_me|示例/i.test(trimmed)) return false;
  try {
    crypto.createPublicKey(trimmed);
    return true;
  } catch (e) {
    return false;
  }
}

function getWechatPayConfigStatus() {
  const missing = [];
  const warnings = [];
  const appid = envAppId();
  const mchid = envMchId();
  const serial = envSerialNo();
  const apiV3 = envApiV3Key();
  const notifyUrl = process.env.WX_PAY_NOTIFY_URL;
  if (!appid) missing.push('WX_PAY_APPID / WX_APPID / WECHAT_APPID');
  if (!mchid) missing.push('WX_PAY_MCHID / WX_MCH_ID');
  if (!serial) missing.push('WX_PAY_SERIAL_NO / WX_MCH_SERIAL_NO');
  if (!apiV3) missing.push('WX_PAY_API_V3_KEY / WX_API_V3_KEY');
  if (!notifyUrl) missing.push('WX_PAY_NOTIFY_URL');
  if (apiV3 && String(apiV3).length !== 32) missing.push('WX_PAY_API_V3_KEY(必须32位)');

  let privateKeyLoadError = null;
  let pem = null;
  try {
    pem = loadPrivateKeyPem();
  } catch (e) {
    privateKeyLoadError = e.message || String(e);
  }
  if (!pem) missing.push('WX_PAY_PRIVATE_KEY_PATH 或 WX_PAY_PRIVATE_KEY');

  const publicKeyPem = loadWechatPayPublicKeyPem();
  const publicKeyId = envWechatPayPublicKeyId();
  if (publicKeyId && !isValidPublicKeyPem(publicKeyPem)) {
    warnings.push(
      'WX_PAY_PUBLIC_KEY 未配置或无效（回调验签将失败）；请在商户平台下载公钥并配置 WX_PAY_PUBLIC_KEY / WX_PAY_PUBLIC_KEY_ID'
    );
  }

  return {
    ok: missing.length === 0 && !privateKeyLoadError,
    missing,
    privateKeyLoadError,
    warnings,
    publicKeyConfigured: isValidPublicKeyPem(publicKeyPem)
  };
}

/** 启动时打印微信支付配置告警 */
function logWechatPayBootCheck() {
  if (!isWechatPayConfigured()) return;
  const cfg = getWechatPayConfigStatus();
  if (cfg.warnings && cfg.warnings.length) {
    cfg.warnings.forEach((w) => console.error('[wechat-pay] 配置告警:', w));
  }
}

function isWechatPayConfigured() {
  return getWechatPayConfigStatus().ok;
}

function getWxAppId() {
  return envAppId();
}

function buildAuthHeader(method, urlPath, bodyStr) {
  const mchid = envMchId();
  const serial = envSerialNo();
  const pem = loadPrivateKeyPem();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${bodyStr}\n`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  sign.end();
  const signature = sign.sign(pem, 'base64');
  const token = [
    `mchid="${mchid}"`,
    `nonce_str="${nonceStr}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${serial}"`,
    `signature="${signature}"`
  ].join(',');
  return `WECHATPAY2-SHA256-RSA2048 ${token}`;
}

async function wechatRequest(method, urlPath, bodyObj) {
  const bodyStr = bodyObj && Object.keys(bodyObj).length ? JSON.stringify(bodyObj) : '';
  const auth = buildAuthHeader(method, urlPath, bodyStr);
  const url = `${BASE}${urlPath}`;
  const headers = {
    Authorization: auth,
    Accept: 'application/json'
  };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }
  const cfg = { method, url, headers, validateStatus: () => true };
  if (method !== 'GET' && method !== 'HEAD') {
    cfg.data = bodyStr;
  }
  const { data, status } = await axios(cfg);
  if (status >= 200 && status < 300) return data;
  const err = new Error(data.message || data.code || `HTTP ${status}`);
  err.status = status;
  err.body = data;
  throw err;
}

function decryptAes256Gcm(apiV3Key, associatedData, nonceStr, ciphertextB64) {
  const key = Buffer.from(apiV3Key, 'utf8');
  if (key.length !== 32) throw new Error('WX_PAY_API_V3_KEY 须为 32 字节');
  const nonceBuf = Buffer.isBuffer(nonceStr) ? nonceStr : Buffer.from(nonceStr, 'utf8');
  const buf = Buffer.from(ciphertextB64, 'base64');
  const authTag = buf.subarray(buf.length - 16);
  const data = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonceBuf);
  decipher.setAuthTag(authTag);
  const aad = associatedData == null ? Buffer.alloc(0) : Buffer.from(String(associatedData), 'utf8');
  decipher.setAAD(aad);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function loadWechatPayPublicKeyPem() {
  const raw = process.env.WX_PAY_PUBLIC_KEY;
  const keyPath = process.env.WX_PAY_PUBLIC_KEY_PATH;
  if (raw && String(raw).trim()) {
    return raw.replace(/\\n/g, '\n');
  }
  if (keyPath) {
    const p = path.isAbsolute(keyPath) ? keyPath : path.join(process.cwd(), keyPath);
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8');
    }
  }
  return null;
}

function envWechatPayPublicKeyId() {
  return process.env.WX_PAY_PUBLIC_KEY_ID || process.env.WX_PAY_PLATFORM_PUBLIC_KEY_ID;
}

function isWechatPayPublicKeySerial(serial) {
  return serial && String(serial).startsWith('PUB_KEY_ID_');
}

async function refreshPlatformCertificates() {
  const apiV3Key = envApiV3Key();
  const data = await wechatRequest('GET', CERTS_PATH, null);
  const serialToPem = {};
  for (const row of data.data || []) {
    const enc = row.encrypt_certificate;
    if (!enc) continue;
    const pem = decryptAes256Gcm(
      apiV3Key,
      enc.associated_data || 'certificate',
      enc.nonce,
      enc.ciphertext
    );
    serialToPem[row.serial_no] = pem;
  }
  platformCertCache = { serialToPem, fetchedAt: Date.now() };
  return serialToPem;
}

async function getPlatformPemForSerial(serial) {
  const publicKeyId = envWechatPayPublicKeyId();
  const publicKeyPem = loadWechatPayPublicKeyPem();
  if (publicKeyPem && publicKeyId && serial === publicKeyId) {
    return publicKeyPem;
  }
  if (isWechatPayPublicKeySerial(serial) && publicKeyPem) {
    if (!publicKeyId || serial === publicKeyId) {
      return publicKeyPem;
    }
  }

  const now = Date.now();
  if (!platformCertCache.serialToPem[serial] || now - platformCertCache.fetchedAt > CERT_CACHE_MS) {
    try {
      await refreshPlatformCertificates();
    } catch (e) {
      const msg = (e.body && e.body.message) || e.message || '';
      if (publicKeyPem && (isWechatPayPublicKeySerial(serial) || (publicKeyId && serial === publicKeyId))) {
        return publicKeyPem;
      }
      if (/无可用的平台证书|RESOURCE_NOT_EXISTS/i.test(msg)) {
        throw new Error(
          `${msg}。请在商户平台下载「微信支付公钥」并配置 WX_PAY_PUBLIC_KEY_ID、WX_PAY_PUBLIC_KEY_PATH`
        );
      }
      throw e;
    }
  }
  let pem = platformCertCache.serialToPem[serial];
  if (!pem) {
    try {
      await refreshPlatformCertificates();
    } catch (e) {
      if (publicKeyPem && isWechatPayPublicKeySerial(serial)) return publicKeyPem;
      throw e;
    }
    pem = platformCertCache.serialToPem[serial];
  }
  if (!pem) throw new Error(`找不到平台证书或公钥 serial=${serial}`);
  return pem;
}

async function verifyWechatpaySignature({ timestamp, nonce, bodyStr, serial, signatureB64 }) {
  const message = `${timestamp}\n${nonce}\n${bodyStr}\n`;
  const pem = await getPlatformPemForSerial(serial);
  const ok = crypto.verify(
    'sha256',
    Buffer.from(message, 'utf8'),
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(signatureB64, 'base64')
  );
  if (!ok) throw new Error('平台证书验签失败');
}

/**
 * JSAPI 统一下单
 * @param {{ out_trade_no: string, description: string, amountFen: number, notify_url: string, openid: string }} p
 */
async function jsapiUnifiedOrder(p) {
  const appid = getWxAppId();
  const mchid = envMchId();
  const body = {
    appid,
    mchid,
    description: p.description.slice(0, 127),
    out_trade_no: p.out_trade_no,
    notify_url: p.notify_url,
    amount: { total: p.amountFen, currency: 'CNY' },
    payer: { openid: p.openid }
  };
  return wechatRequest('POST', JSAPI_PATH, body);
}

/**
 * 小程序调起支付五参数（signType: RSA）
 */
function buildJsapiPayParams(prepayId) {
  const appId = getWxAppId();
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const pkg = `prepay_id=${prepayId}`;
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  const pem = loadPrivateKeyPem();
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message);
  sign.end();
  const paySign = sign.sign(pem, 'base64');
  return {
    timeStamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign
  };
}

/**
 * 解析并校验支付通知（V3）
 * @returns {Promise<{ plain: object, resource: object }>}
 */
async function parsePayNotification(headers, rawBodyStr) {
  const sig = headers['wechatpay-signature'];
  const ts = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const serial = headers['wechatpay-serial'];
  if (!sig || !ts || !nonce || !serial) {
    throw new Error('缺少微信支付通知头');
  }
  await verifyWechatpaySignature({
    timestamp: ts,
    nonce,
    bodyStr: rawBodyStr,
    serial,
    signatureB64: sig
  });

  const outer = JSON.parse(rawBodyStr);
  const resource = outer.resource;
  if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM') {
    throw new Error('通知 resource 格式异常');
  }
  const apiV3Key = envApiV3Key();
  const jsonStr = decryptAes256Gcm(
    apiV3Key,
    resource.associated_data || '',
    resource.nonce,
    resource.ciphertext
  );
  const plain = JSON.parse(jsonStr);
  return { plain, outer };
}

function yuanToFen(yuan) {
  const n = Number(yuan);
  if (!Number.isFinite(n) || n < 0) throw new Error('金额非法');
  return Math.round(n * 100);
}

/**
 * V3 查单：按商户单号查询 JSAPI 订单
 * @see https://pay.weixin.qq.com/doc/v3/merchant/4012791868
 */
async function queryJsapiOrderByOutTradeNo(outTradeNo) {
  const mchid = envMchId();
  if (!mchid) throw new Error('缺少 WX_PAY_MCHID');
  const out = encodeURIComponent(String(outTradeNo).trim());
  const urlPath = `/v3/pay/transactions/out-trade-no/${out}?mchid=${mchid}`;
  return wechatRequest('GET', urlPath, null);
}

/** 验签失败时尝试解密通知体，仅用于日志（不替代验签） */
function tryPeekNotifyPlain(rawBodyStr) {
  if (!rawBodyStr) return null;
  try {
    const outer = JSON.parse(rawBodyStr);
    const resource = outer.resource;
    if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM') return null;
    const apiV3Key = envApiV3Key();
    const jsonStr = decryptAes256Gcm(
      apiV3Key,
      resource.associated_data || '',
      resource.nonce,
      resource.ciphertext
    );
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

module.exports = {
  isWechatPayConfigured,
  getWechatPayConfigStatus,
  logWechatPayBootCheck,
  isValidPublicKeyPem,
  getWxAppId,
  jsapiUnifiedOrder,
  buildJsapiPayParams,
  parsePayNotification,
  queryJsapiOrderByOutTradeNo,
  tryPeekNotifyPlain,
  yuanToFen,
  wechatSuccessBody: () => ({ code: 'SUCCESS', message: '成功' })
};
