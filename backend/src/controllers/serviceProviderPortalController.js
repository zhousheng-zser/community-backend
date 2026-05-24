/** 兼容旧服务商门户登录；工作台已改用用户 JWT */
exports.login = async (req, res) => {
  return res.status(410).json({
    code: 1,
    msg: '请使用用户端登录后访问服务商工作台'
  });
};
