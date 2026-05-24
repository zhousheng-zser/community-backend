'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Post extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Post.belongsTo(models.User, { foreignKey: 'user_id', as: 'author' });
      Post.hasMany(models.Comment, { foreignKey: 'post_id', as: 'comments' });
      Post.hasMany(models.Like, { foreignKey: 'post_id', as: 'likes' });
    }
  }
  Post.init({
    user_id: DataTypes.BIGINT,
    content: DataTypes.TEXT,
    images: DataTypes.JSON,
    location: DataTypes.STRING,
    category: DataTypes.STRING,
    community_id: DataTypes.BIGINT
  }, {
    sequelize,
    modelName: 'Post',
    tableName: 'posts',
    underscored: false,
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  });
  return Post;
};
