/** 兼容旧商户门户登录；工作台已改用用户 JWT */
exports.login = async (req, res) => {
  return res.status(410).json({
    errno: 410,
    code: 410,
    msg: '请使用用户端登录后访问集市商家工作台',
    errmsg: '请使用用户端登录后访问集市商家工作台'
  });
};
