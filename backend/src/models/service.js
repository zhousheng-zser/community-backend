'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Service extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Service.belongsTo(models.Category, { foreignKey: 'category_id', as: 'category' });
      Service.hasMany(models.ServiceOrder, { foreignKey: 'service_id', as: 'serviceOrders' });
    }
  }
  Service.init({
    category_id: DataTypes.INTEGER,
    title: DataTypes.STRING,
    description: DataTypes.TEXT,
    price: DataTypes.DECIMAL,
    cover_image: DataTypes.STRING,
    sales_count: DataTypes.INTEGER,
    is_published: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    detail_images: DataTypes.JSON,
    tags: DataTypes.JSON,
    sub_title: DataTypes.STRING(200),
    provider_id: DataTypes.INTEGER,
    order_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    sequelize,
    modelName: 'Service',
    tableName: 'services',
    timestamps: true,
    underscored: false
  });
  return Service;
};
