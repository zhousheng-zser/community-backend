'use strict';
const { Model } = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Category extends Model {
    static associate(models) {
      Category.hasMany(models.Service, { foreignKey: 'category_id', as: 'services' });
    }
  }
  Category.init({
    name: DataTypes.STRING,
    icon_url: DataTypes.STRING,
    sort_order: DataTypes.INTEGER,
    group_type: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'Category',
    tableName: 'categories',
    underscored: false
  });
  return Category;
};
