const { Op } = require('sequelize');
const { WorkerApplication, WorkerProfile, User, ApprovalRecord } = require('../models');
const { logAdminAction } = require('./adminAuditHelper');

function parseCommunityId(q) {
    if (q === undefined || q === null || q === '') return null;
    const c = parseInt(String(q), 10);
    return Number.isFinite(c) ? c : null;
}

/** 九州派单下拉：已存在 worker-applications 路由，加 for_dispatch=1 即可（无需新路径） */
async function listDispatchWorkers(req, res) {
    try {
        const cid = parseCommunityId(req.query.community_id);
        const map = new Map();

        const profiles = await WorkerProfile.findAll({
            where: { status: 'active', user_id: { [Op.ne]: null } },
            order: [['real_name', 'ASC']],
            limit: 500,
            include: [{
                model: User,
                as: 'user',
                attributes: ['id', 'nickname', 'phone', 'community_id', 'role'],
                required: false
            }]
        });
        for (const p of profiles) {
            const u = p.user || {};
            const effectiveComm =
                p.community_id != null ? Number(p.community_id) : u.community_id != null ? Number(u.community_id) : null;
            if (cid != null && (effectiveComm == null || effectiveComm !== cid)) continue;
            const uid = p.user_id;
            if (uid == null || uid === '') continue;
            map.set(String(uid), {
                id: String(uid),
                user_id: String(uid),
                name: p.real_name || u.nickname || '',
                phone: p.phone || u.phone || '',
                industry: p.industry || '',
                community_id: effectiveComm
            });
        }

        const userWhere = { role: 'worker' };
        if (cid != null) userWhere.community_id = cid;
        const users = await User.findAll({
            where: userWhere,
            attributes: ['id', 'nickname', 'phone', 'community_id'],
            order: [['nickname', 'ASC']],
            limit: 300
        });
        for (const u of users) {
            map.set(String(u.id), {
                id: String(u.id),
                user_id: String(u.id),
                name: u.nickname || '',
                phone: u.phone || '',
                industry: '',
                community_id: u.community_id != null ? u.community_id : cid
            });
        }

        const list = Array.from(map.values()).sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
        );
        return res.json({ errno: 0, message: 'ok', data: list });
    } catch (e) {
        console.error('listDispatchWorkers:', e);
        return res.status(500).json({ errno: 500, error: '查询技工失败' });
    }
}

async function writeApproval(bizType, bizId, fromStatus, toStatus, operator, note) {
    try {
        await ApprovalRecord.create({
            biz_type: bizType,
            biz_id: String(bizId),
            from_status: fromStatus || null,
            to_status: toStatus,
            operator,
            note: note || null
        });
    } catch (_e) {}
}

exports.getWorkerApplications = async (req, res) => {
    try {
        if (req.query.for_dispatch === '1' || req.query.for_dispatch === 'true') {
            return listDispatchWorkers(req, res);
        }
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 100);
        const offset = (page - 1) * limit;
        const status = req.query.status;
        const where = status ? { status } : {};
        const include = [];
        if (
            User &&
            WorkerApplication.associations &&
            WorkerApplication.associations.user
        ) {
            include.push({
                model: User,
                as: 'user',
                attributes: ['id', 'nickname', 'avatar_url', 'phone', 'community_id'],
                required: false
            });
        }
        const { rows, count } = await WorkerApplication.findAndCountAll({
            where,
            offset,
            limit,
            order: [['created_at', 'DESC']],
            include
        });
        res.json({ message: 'ok', total: count, page, limit, data: rows });
    } catch (e) {
        console.error('getWorkerApplications:', e);
        res.status(500).json({ error: '加载技工申请失败，请稍后重试' });
    }
};

exports.updateWorkerApplication = async (req, res) => {
    try {
        const id = req.params.id;
        const { status, note } = req.body || {};
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ error: 'status 须为 approved 或 rejected' });
        }
        const row = await WorkerApplication.findByPk(id);
        if (!row) return res.status(404).json({ error: '申请不存在' });
        const fromStatus = row.status;
        row.status = status;
        await row.save();
        let user = row.user_id ? await User.findByPk(row.user_id) : null;
        if (!user && row.phone) {
            user = await User.findOne({ where: { phone: String(row.phone) } });
            if (user && !row.user_id) {
                row.user_id = user.id;
                await row.save();
            }
        }
        if (status === 'approved') {
            await WorkerProfile.upsert({
                user_id: row.user_id || (user && user.id),
                application_id: row.id,
                real_name: row.name,
                phone: row.phone,
                industry: row.industry,
                education: row.education || null,
                city: row.city || null,
                resume: row.resume || null,
                id_card_url: row.id_card_url,
                work_photo_url: row.work_photo_url || null,
                certificate_url: row.certificate_url || null,
                community_id: user && user.community_id != null ? user.community_id : null,
                status: 'active'
            });
            if (user) {
                user.role = 'worker';
                if (!user.phone && row.phone) user.phone = row.phone;
                if (!user.nickname && row.name) user.nickname = row.name;
                await user.save();
            }
        } else if (fromStatus === 'approved') {
            const profile = await WorkerProfile.findOne({ where: { application_id: row.id } });
            if (profile) await profile.update({ status: 'inactive' });
            if (user) {
                const activeCount = await WorkerProfile.count({
                    where: { user_id: row.user_id, status: 'active' }
                });
                if (activeCount === 0 && user.role === 'worker') {
                    user.role = 'user';
                    await user.save();
                }
            }
        }
        await writeApproval(
            'worker_application',
            row.id,
            fromStatus,
            status,
            (req.admin && req.admin.sub) || 'admin',
            note
        );
        await logAdminAction(req, 'update_worker_application', 'worker_application', row.id, {
            fromStatus,
            toStatus: status,
            note: note || ''
        });
        res.json({ message: 'ok', data: row });
    } catch (e) {
        console.error('updateWorkerApplication:', e);
        res.status(500).json({ error: '更新申请失败，请稍后重试' });
    }
};

