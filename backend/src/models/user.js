'use strict';
const { Model } = require('sequelize');
const { nextSnowflakeId } = require('../utils/snowflake');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.hasMany(models.Post, { foreignKey: 'user_id', as: 'posts' });
      User.hasMany(models.Comment, { foreignKey: 'user_id', as: 'comments' });
      User.hasMany(models.Like, { foreignKey: 'user_id', as: 'likes' });
      User.hasMany(models.User, { foreignKey: 'invited_by', as: 'invitees' });
      User.belongsTo(models.User, { foreignKey: 'invited_by', as: 'inviter' });
      User.hasMany(models.UserCommunityBinding, { foreignKey: 'user_id', as: 'communityBindings' });
    }
  }
  User.init(
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false
      },
      openid: DataTypes.STRING,
      nickname: DataTypes.STRING,
      avatar_url: DataTypes.STRING,
      bg_image: DataTypes.STRING,
      phone: DataTypes.STRING,
      address: DataTypes.STRING,
      bank_num: DataTypes.STRING,
      wx_id: DataTypes.STRING,
      role: DataTypes.STRING,
      balance: DataTypes.DECIMAL(10, 2),
      community_id: DataTypes.BIGINT,
      token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      invite_code: { type: DataTypes.STRING(16), allowNull: true },
      invited_by: { type: DataTypes.BIGINT, allowNull: true }
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      hooks: {
        beforeValidate(user) {
          if (!user.id) {
            user.id = nextSnowflakeId();
          }
        }
      }
    }
  );
  return User;
};
