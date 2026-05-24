const { Op } = require('sequelize');
const { WorkerApplication, ServiceProviderApplication, MarketApplication } = require('../models');
const { resolveUserId } = require('../utils/resolveUserId');
const { normalizeShopCategory, resolveShopCoordinates } = require('../constants/marketCategoryMap');

function authUserId(req) {
    return resolveUserId(req.user && req.user.id);
}

async function findLatestApplication(Model, userId) {
    return Model.findOne({
        where: { user_id: userId },
        order: [['created_at', 'DESC'], ['id', 'DESC']]
    });
}

function handleDbError(res, e, label) {
    const msg = e && (e.original && e.original.message || e.message) || String(e);
    console.error(`${label}:`, msg, e && e.original || '');
    const isDev = process.env.NODE_ENV !== 'production';
    const body = {
        code: 1,
        msg: '提交失败，请重试',
        errmsg: '提交失败，请重试',
        error: '提交失败',
        ...(isDev && { errMsg: msg })
    };
    if (msg && /doesn't exist|Unknown column/i.test(msg)) {
        body.hint = '若为表/字段不存在，请执行数据库迁移：cd backend && npx sequelize-cli db:migrate';
    }
    return res.status(500).json(body);
}

function normMediaUrl(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'object' && v.url) return String(v.url).trim().slice(0, 500);
    return String(v).trim().slice(0, 500);
}

function normCertUrls(v) {
    const out = [];
    const walk = (x) => {
        if (x == null || x === '') return;
        if (Array.isArray(x)) {
            x.forEach(walk);
            return;
        }
        if (typeof x === 'object' && x.url) {
            walk(x.url);
            return;
        }
        const s = normMediaUrl(x);
        if (s) out.push(s);
    };
    walk(v);
    return out;
}

function normServices(v) {
    if (!v) return [];
    const arr = Array.isArray(v) ? v : [];
    return arr
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const name = String(item.name || '').trim();
            if (!name) return null;
            return {
                name,
                price: item.price != null ? String(item.price).trim() : '',
                desc: item.desc != null ? String(item.desc).trim() : ''
            };
        })
        .filter(Boolean);
}

async function supersedeOtherPendingApplications(Model, userId, keepId) {
    if (!userId || !keepId) return;
    await Model.update(
        { status: 'rejected', reject_reason: '已重新提交，本条申请自动关闭' },
        {
            where: {
                user_id: userId,
                status: 'pending',
                id: { [Op.ne]: keepId }
            }
        }
    );
}

// 技工入驻申请 POST /api/v1/worker/apply
exports.workerApply = async (req, res) => {
    try {
        const userId = authUserId(req);
        if (!userId) {
            return res.status(401).json({ code: 1, msg: '请先登录', errmsg: '请先登录' });
        }
        const body = req.body || {};
        const name = String(body.name || '').trim();
        const phone = String(body.phone || '').trim();
        const industry = String(body.industry || '').trim();
        const idCardUrl = normMediaUrl(body.id_card_url);
        if (!name || !phone || !industry || !idCardUrl) {
            return res.status(400).json({
                code: 1,
                msg: '请填写姓名、手机号、意向行业并上传身份证照片',
                errmsg: '请填写姓名、手机号、意向行业并上传身份证照片'
            });
        }
        const payload = {
            user_id: userId,
            name,
            phone,
            industry,
            education: body.education ? String(body.education).trim() : null,
            city: body.city ? String(body.city).trim() : null,
            resume: body.resume ? String(body.resume).trim() : null,
            id_card_url: idCardUrl.slice(0, 255),
            work_photo_url: normMediaUrl(body.work_photo_url) || null,
            certificate_url: normCertUrls(body.certificate_url),
            services: normServices(body.services),
            status: 'pending',
            reject_reason: ''
        };

        const existing = await findLatestApplication(WorkerApplication, userId);
        if (existing && existing.status === 'approved') {
            return res.json({
                code: 0,
                msg: '您已是认证技工，无需重复申请',
                data: { application_id: existing.id, status: 'approved' }
            });
        }
        if (existing) {
            await existing.update({
                ...payload,
                reviewed_by: null,
                reviewed_at: null
            });
            await supersedeOtherPendingApplications(WorkerApplication, userId, existing.id);
            return res.json({
                code: 0,
                msg: '申请提交成功，请等待运营审核',
                data: { application_id: existing.id, status: 'pending' }
            });
        }

        const row = await WorkerApplication.create(payload);
        await supersedeOtherPendingApplications(WorkerApplication, userId, row.id);
        return res.status(201).json({
            code: 0,
            msg: '申请提交成功，请等待运营审核',
            data: { application_id: row.id, status: row.status }
        });
    } catch (e) {
        return handleDbError(res, e, '技工入驻申请失败');
    }
};

// 服务商入驻申请 POST /api/v1/service-provider/apply
exports.serviceProviderApply = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: '未登录' });
        }
        const userId = req.user.id;
        const { shop_name, contact_name, phone, license_url, shop_front_url, environment_url, id_card_url, certificate_url } = req.body;
        if (!shop_name || !contact_name || !phone || !license_url || !id_card_url) {
            return res.status(400).json({ error: '请填写必填项：shop_name、contact_name、phone、license_url、id_card_url' });
        }
        const row = await ServiceProviderApplication.create({
            user_id: userId,
            shop_name,
            contact_name,
            phone,
            license_url,
            shop_front_url: shop_front_url || null,
            environment_url: Array.isArray(environment_url) ? environment_url : null,
            id_card_url,
            certificate_url: Array.isArray(certificate_url) ? certificate_url : null,
            status: 'pending'
        });
        res.status(201).json({
            code: 0,
            msg: '申请提交成功，请等待运营审核',
            data: { application_id: row.id, status: row.status }
        });
    } catch (e) {
        return handleDbError(res, e, '服务商入驻申请失败');
    }
};

// GET /api/v1/worker/application/me — 当前用户最新技工入驻申请
exports.getWorkerApplicationMe = async (req, res) => {
    try {
        const userId = authUserId(req);
        if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
        const row = await findLatestApplication(WorkerApplication, userId);
        return res.json({ code: 0, msg: row ? 'ok' : '暂无申请记录', data: row });
    } catch (e) {
        console.error('getWorkerApplicationMe:', e);
        return res.status(500).json({ code: 1, msg: '查询失败' });
    }
};

// GET /api/v1/service-provider/application/me — 当前用户最新服务商入驻申请
exports.getServiceProviderApplicationMe = async (req, res) => {
    try {
        const userId = authUserId(req);
        if (!userId) return res.status(401).json({ code: 1, msg: '未登录' });
        const row = await findLatestApplication(ServiceProviderApplication, userId);
        return res.json({ code: 0, msg: row ? 'ok' : '暂无申请记录', data: row });
    } catch (e) {
        console.error('getServiceProviderApplicationMe:', e);
        return res.status(500).json({ code: 1, msg: '查询失败' });
    }
};

// 集市商家入驻申请 POST /api/v1/market/apply 与 POST /api/v1/market/merchant/apply
exports.marketApply = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: '未登录' });
        }
        const userId = req.user.id;
        const {
            shop_name, contact_name, phone, category, address, description,
            promoter_id, promoter_name, promoter,
            credit_code, legal_person, entity_name,
            place_photo_url, license_url, logo_url, background_url, community_id,
            latitude, longitude, lat, lng
        } = req.body;
        const coords = resolveShopCoordinates({ latitude, longitude, lat, lng });
        if (!contact_name || !phone || !shop_name || !category || !address) {
            return res.status(400).json({ error: '请填写必填项：shop_name、contact_name、phone、category、address' });
        }
        if (!entity_name || !credit_code || !legal_person) {
            return res.status(400).json({ error: '请填写公司资质：entity_name、credit_code、legal_person' });
        }
        if (!logo_url || !background_url || !license_url) {
            return res.status(400).json({ error: '请上传图片：logo_url、background_url、license_url' });
        }
        const promoterLabel = promoter_name != null && promoter_name !== '' ? promoter_name : promoter;
        const row = await MarketApplication.create({
            user_id: userId,
            contact_name,
            phone,
            shop_name,
            category: normalizeShopCategory(category),
            address,
            latitude: coords.latitude,
            longitude: coords.longitude,
            description: description || null,
            promoter_id: promoter_id || null,
            promoter_name: promoterLabel || null,
            credit_code: credit_code || null,
            legal_person: legal_person || null,
            entity_name: entity_name || null,
            place_photo_url: Array.isArray(place_photo_url) ? place_photo_url : null,
            license_url: license_url || null,
            logo_url: logo_url || null,
            background_url: background_url || null,
            community_id: community_id || null,
            status: 'pending'
        });
        res.status(201).json({
            code: 0,
            msg: '申请提交成功',
            data: row
                ? {
                    application_id: row.id,
                    status: row.status,
                    latitude: row.latitude,
                    longitude: row.longitude
                }
                : null
        });
    } catch (e) {
        return handleDbError(res, e, '集市入驻申请失败');
    }
};
