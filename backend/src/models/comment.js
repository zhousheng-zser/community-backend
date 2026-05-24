'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Comment extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Comment.belongsTo(models.Post, { foreignKey: 'post_id', as: 'post' });
      Comment.belongsTo(models.User, { foreignKey: 'user_id', as: 'author' });
      // 如果属于回复某人的自关联
      Comment.belongsTo(models.User, { foreignKey: 'reply_to_user_id', as: 'replyToUser' });
    }
  }
  Comment.init({
    post_id: DataTypes.INTEGER,
    user_id: DataTypes.BIGINT,
    content: DataTypes.TEXT,
    reply_to_user_id: DataTypes.BIGINT,
    image_urls: DataTypes.JSON
  }, {
    sequelize,
    modelName: 'Comment',
    tableName: 'comments',
    underscored: false,
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  });
  return Comment;
};
