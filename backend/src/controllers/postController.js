const { Post, User, Comment, Like } = require('../models');
const { resolveUserId } = require('../utils/resolveUserId');

function postsResponse(posts, page, limit) {
    const rows = posts.rows;
    return {
        message: '获取成功',
        total: posts.count,
        page,
        limit,
        list: rows,
        data: rows
    };
}

/** 当前浏览者所属小区：query 优先，否则读登录用户 users.community_id */
async function resolveViewerCommunityId(req) {
    if (req.query.community_id != null && req.query.community_id !== '') {
        const cid = parseInt(req.query.community_id, 10);
        if (Number.isFinite(cid) && cid > 0) return cid;
    }
    const userId = resolveUserId(req.user && req.user.id);
    if (!userId) return null;
    const user = await User.findByPk(userId, { attributes: ['community_id'] });
    if (!user || user.community_id == null) return null;
    const cid = parseInt(user.community_id, 10);
    return Number.isFinite(cid) && cid > 0 ? cid : null;
}

async function assertPostVisibleToViewer(post, viewerCommunityId) {
    if (!post) return { ok: false, status: 404, error: '帖子不存在' };
    if (viewerCommunityId == null) {
        return { ok: false, status: 403, error: '请先绑定所属小区' };
    }
    const pc = post.community_id != null ? Number(post.community_id) : null;
    if (pc != null && pc !== Number(viewerCommunityId)) {
        return { ok: false, status: 403, error: '无权查看其他小区的帖子' };
    }
    return { ok: true };
}

// 1. 获取社区帖子列表 (朋友图形式：按时间倒序排，带上用户信息、评论、点赞)
exports.getPosts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const hasAuthHeader = !!(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
        if (hasAuthHeader && !req.user) {
            return res.status(401).json({ error: '登录已失效，请重新登录', errno: 401, errmsg: '登录已失效，请重新登录' });
        }

        const communityId = await resolveViewerCommunityId(req);
        if (!communityId) {
            return res.json(postsResponse({ count: 0, rows: [] }, page, limit));
        }

        const whereClause = { community_id: communityId };
        if (req.query.category) {
            whereClause.category = req.query.category;
        }

        const posts = await Post.findAndCountAll({
            where: whereClause,
            offset: offset,
            limit: limit,
            order: [['createdAt', 'DESC']],
            include: [
                {
                    model: User,
                    as: 'author',
                    attributes: ['id', 'nickname', 'avatar_url', 'bg_image']
                },
                {
                    model: Comment,
                    as: 'comments',
                    include: [
                        { model: User, as: 'author', attributes: ['id', 'nickname'] },
                        { model: User, as: 'replyToUser', attributes: ['id', 'nickname'] }
                    ]
                },
                {
                    model: Like,
                    as: 'likes',
                    include: [{ model: User, as: 'user', attributes: ['id', 'nickname'] }]
                }
            ]
        });

        res.json(postsResponse(posts, page, limit));
    } catch (error) {
        console.error('获取帖子失败:', error);
        res.status(500).json({ error: '获取帖子失败' });
    }
};

// 1.0 帖子详情
exports.getPostDetail = async (req, res) => {
    try {
        const postId = parseInt(req.params.postId, 10);
        if (!Number.isFinite(postId) || postId <= 0) {
            return res.status(400).json({ error: '无效帖子 id' });
        }

        const hasAuthHeader = !!(req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
        if (hasAuthHeader && !req.user) {
            return res.status(401).json({ error: '登录已失效，请重新登录', errno: 401, errmsg: '登录已失效，请重新登录' });
        }

        const post = await Post.findByPk(postId, {
            include: [
                {
                    model: User,
                    as: 'author',
                    attributes: ['id', 'nickname', 'avatar_url', 'bg_image']
                },
                {
                    model: Comment,
                    as: 'comments',
                    include: [
                        { model: User, as: 'author', attributes: ['id', 'nickname', 'avatar_url'] },
                        { model: User, as: 'replyToUser', attributes: ['id', 'nickname'] }
                    ]
                },
                {
                    model: Like,
                    as: 'likes',
                    include: [{ model: User, as: 'user', attributes: ['id', 'nickname'] }]
                }
            ]
        });

        let viewerCommunityId = await resolveViewerCommunityId(req);
        if (!viewerCommunityId && post && post.community_id != null) {
            const pc = parseInt(post.community_id, 10);
            if (Number.isFinite(pc) && pc > 0) viewerCommunityId = pc;
        }
        if (!viewerCommunityId) {
            return res.status(403).json({ errno: 403, error: '请先绑定所属小区', errmsg: '请先绑定所属小区' });
        }

        const vis = await assertPostVisibleToViewer(post, viewerCommunityId);
        if (!vis.ok) return res.status(vis.status).json({ errno: vis.status, error: vis.error, errmsg: vis.error });

        res.json({ message: '获取成功', data: post });
    } catch (error) {
        console.error('获取帖子详情失败:', error);
        res.status(500).json({ error: '获取帖子详情失败' });
    }
};

// 1.1 获取我发布的帖子
exports.getMyPublishedPosts = async (req, res) => {
    try {
        const userId = resolveUserId(req.user && req.user.id);
        if (!userId) return res.status(401).json({ error: '未登录' });
        const communityId = await resolveViewerCommunityId(req);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const where = { user_id: userId };
        if (communityId) where.community_id = communityId;

        const posts = await Post.findAndCountAll({
            where,
            offset: offset,
            limit: limit,
            order: [['createdAt', 'DESC']],
            include: [
                { model: User, as: 'author', attributes: ['id', 'nickname', 'avatar_url', 'bg_image'] },
                { model: Comment, as: 'comments', include: [{ model: User, as: 'author', attributes: ['id', 'nickname'] }] },
                { model: Like, as: 'likes', include: [{ model: User, as: 'user', attributes: ['id', 'nickname'] }] }
            ]
        });

        res.json(postsResponse(posts, page, limit));
    } catch (error) {
        console.error('获取我的发布失败:', error);
        res.status(500).json({ error: '获取我的发布失败' });
    }
};

// 1.2 获取我点赞过的帖子
exports.getMyLikedPosts = async (req, res) => {
    try {
        const userId = resolveUserId(req.user && req.user.id);
        if (!userId) return res.status(401).json({ error: '未登录' });
        const communityId = await resolveViewerCommunityId(req);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Find likes by this user
        const likes = await Like.findAll({
            where: { user_id: userId },
            attributes: ['post_id']
        });
        const postIds = likes.map(like => like.post_id);
        if (!postIds.length) {
            return res.json(postsResponse({ count: 0, rows: [] }, page, limit));
        }

        const likedWhere = { id: postIds };
        if (communityId) likedWhere.community_id = communityId;

        const posts = await Post.findAndCountAll({
            where: likedWhere,
            offset: offset,
            limit: limit,
            order: [['createdAt', 'DESC']],
            include: [
                { model: User, as: 'author', attributes: ['id', 'nickname', 'avatar_url', 'bg_image'] },
                { model: Comment, as: 'comments', include: [{ model: User, as: 'author', attributes: ['id', 'nickname'] }] },
                { model: Like, as: 'likes', include: [{ model: User, as: 'user', attributes: ['id', 'nickname'] }] }
            ]
        });

        res.json(postsResponse(posts, page, limit));
    } catch (error) {
        console.error('获取我的点赞失败:', error);
        res.status(500).json({ error: '获取我的点赞失败' });
    }
};

// 1.3 获取我参与的话题/活动 (发过或者评论过的某分类的帖子)
exports.getMyParticipatedPosts = async (req, res) => {
    try {
        const userId = resolveUserId(req.user && req.user.id);
        if (!userId) return res.status(401).json({ error: '未登录' });
        const communityId = await resolveViewerCommunityId(req);
        const category = req.query.category; // "热门话题" or "热门活动"
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        if (!category) return res.status(400).json({ error: '缺少分类参数' });

        // 先找我评论过的帖子ID
        const myComments = await Comment.findAll({
            where: { user_id: userId },
            attributes: ['post_id']
        });
        const commentedPostIds = myComments.map(c => c.post_id);

        const { Op } = require('sequelize');

        const baseWhere = {
            category: category,
            [Op.or]: [
                { user_id: userId },
                { id: commentedPostIds }
            ]
        };
        if (communityId) baseWhere.community_id = communityId;

        const posts = await Post.findAndCountAll({
            where: baseWhere,
            offset: offset,
            limit: limit,
            order: [['createdAt', 'DESC']],
            include: [
                { model: User, as: 'author', attributes: ['id', 'nickname', 'avatar_url', 'bg_image'] },
                { model: Comment, as: 'comments', include: [{ model: User, as: 'author', attributes: ['id', 'nickname'] }] },
                { model: Like, as: 'likes', include: [{ model: User, as: 'user', attributes: ['id', 'nickname'] }] }
            ]
        });

        res.json(postsResponse(posts, page, limit));
    } catch (error) {
        console.error('获取参与数据失败:', error);
        res.status(500).json({ error: '获取参与数据失败' });
    }
};

// 2. 发帖子 (纯文字或带图片)
exports.createPost = async (req, res) => {
    try {
        // req.user 来源于 authMiddleware
        const userId = resolveUserId(req.user && req.user.id);
        if (!userId) return res.status(401).json({ error: '未登录' });
        const { content, location, category } = req.body;
        const cat = category || req.query.category || '热门话题';

        const user = await User.findByPk(userId, { attributes: ['community_id'] });
        let commId = user && user.community_id != null ? parseInt(user.community_id, 10) : null;
        if (!Number.isFinite(commId) || commId <= 0) commId = null;

        const bodyCid = req.body.community_id != null ? req.body.community_id : req.body.communityId;
        if (!commId && bodyCid != null && bodyCid !== '') {
            const parsed = parseInt(bodyCid, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                commId = parsed;
                if (user) {
                    user.community_id = parsed;
                    await user.save();
                }
            }
        }

        if (!commId) {
            return res.status(400).json({
                error: '请先绑定所属小区后再发帖',
                errmsg: '请先在首页选择合川路等服务站点，或联系管理员绑定小区'
            });
        }

        // 解析通过 multer 上传的图片路径，或者直接使用前端传过来的已上传的图片URL数组
        let imagePaths = [];
        if (req.body.images && Array.isArray(req.body.images)) {
            imagePaths = req.body.images;
        } else if (req.files && req.files.length > 0) {
            imagePaths = req.files.map(file => `/uploads/${file.filename}`);
        }

        if (!content && imagePaths.length === 0) {
            return res.status(400).json({ error: '帖子不能完全为空' });
        }

        const newPost = await Post.create({
            user_id: userId,
            content: content || '',
            category: cat,
            community_id: commId,
            images: imagePaths,
            location: location || ''
        });

        res.status(201).json({
            message: '发布成功',
            data: newPost
        });

    } catch (error) {
        console.error('发布帖子失败:', error);
        res.status(500).json({ error: '发布帖子失败' });
    }
};

// 3. 点赞/取消点赞
exports.toggleLike = async (req, res) => {
    try {
        const userId = resolveUserId(req.user && req.user.id);
        if (!userId) return res.status(401).json({ error: '未登录' });
        const postId = req.params.postId;
        const viewerCommunityId = await resolveViewerCommunityId(req);

        const post = await Post.findByPk(postId);
        const vis = await assertPostVisibleToViewer(post, viewerCommunityId);
        if (!vis.ok) return res.status(vis.status).json({ error: vis.error });

        // 查找是否已经点过赞
        const existingLike = await Like.findOne({
            where: { user_id: userId, post_id: postId }
        });

        if (existingLike) {
            // 已点赞，则取消
            await existingLike.destroy();
            return res.json({ message: '取消点赞成功', status: 'unliked' });
        } else {
            // 未点赞，则添加
            await Like.create({ user_id: userId, post_id: postId });
            return res.json({ message: '点赞成功', status: 'liked' });
        }

    } catch (error) {
        console.error('操作点赞失败:', error);
        res.status(500).json({ error: '操作点赞失败' });
    }
};

// 4. 发表评论（支持 content、reply_to_user_id、image_urls）
exports.addComment = async (req, res) => {
    try {
        const userId = resolveUserId(req.user && req.user.id);
        if (!userId) return res.status(401).json({ error: '未登录' });
        const postId = req.params.postId;
        const viewerCommunityId = await resolveViewerCommunityId(req);
        const { content, reply_to_user_id, image_urls } = req.body;

        if (!content && (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0)) {
            return res.status(400).json({ error: '评论内容或图片不能同时为空' });
        }

        const post = await Post.findByPk(postId);
        const vis = await assertPostVisibleToViewer(post, viewerCommunityId);
        if (!vis.ok) return res.status(vis.status).json({ error: vis.error });

        const newComment = await Comment.create({
            post_id: postId,
            user_id: userId,
            content: content || '',
            reply_to_user_id: reply_to_user_id || null,
            image_urls: Array.isArray(image_urls) ? image_urls : null
        });

        res.status(201).json({
            code: 0,
            msg: '评论成功',
            data: {
                comment_id: newComment.id,
                image_urls: newComment.image_urls || [],
                created_at: newComment.createdAt
            }
        });

    } catch (error) {
        const msg = error && (error.original && error.original.message || error.message) || String(error);
        console.error('评论失败:', msg, error && error.original || '');
        res.status(500).json({
            error: '评论失败',
            ...(process.env.NODE_ENV !== 'production' && { errMsg: msg })
        });
    }
};
