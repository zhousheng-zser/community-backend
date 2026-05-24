/**
 * 从 JWT / req.user 解析用户主键（雪花 id 必须用字符串，禁止 Number 转换）
 */
function resolveUserId(raw) {
  if (raw == null || raw === '') return null;
  const id = String(raw).trim();
  if (!id) return null;
  if (!/^\d+$/.test(id)) return null;
  return id;
}

/** 从 Express req 解析当前登录用户 id（管理员 token 返回 null） */
function resolveUserIdFromReq(req) {
  if (!req || !req.user) return null;
  if (req.user.admin === true) return null;
  const raw = req.user.id != null ? req.user.id : req.user.sub;
  return resolveUserId(raw);
}

module.exports = { resolveUserId, resolveUserIdFromReq };
