'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

function requestJson(options) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.url);
    const body = options.body || '';
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers: Object.assign(
          { 'Content-Type': options.contentType || 'application/json', 'Content-Length': Buffer.byteLength(body) },
          options.headers || {}
        ),
        timeout: options.timeout || 15000
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (e) {
            parsed = { _raw: raw };
          }
          if (res.statusCode >= 400) {
            const err = new Error(parsed.message || parsed.msg || `HTTP ${res.statusCode}`);
            err.statusCode = res.statusCode;
            err.response = parsed;
            return reject(err);
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function postForm(url, params) {
  const body = new URLSearchParams();
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null || v === '') return;
    body.append(k, String(v));
  });
  return requestJson({
    url,
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    body: body.toString()
  });
}

function postJson(url, payload) {
  return requestJson({
    url,
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify(payload)
  });
}

function getJson(url) {
  return requestJson({ url, method: 'GET' });
}

module.exports = { requestJson, postForm, postJson, getJson };
