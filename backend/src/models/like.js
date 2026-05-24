'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Like extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Like.belongsTo(models.Post, { foreignKey: 'post_id', as: 'post' });
      Like.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }
  Like.init({
    post_id: DataTypes.INTEGER,
    user_id: DataTypes.BIGINT
  }, {
    sequelize,
    modelName: 'Like',
    tableName: 'likes',
    underscored: false,
    timestamps: true,
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  });
  return Like;
};
