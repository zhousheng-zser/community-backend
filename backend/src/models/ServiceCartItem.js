'use strict';

module.exports = (sequelize, DataTypes) => {
  const ServiceCartItem = sequelize.define('ServiceCartItem', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    provider_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    service_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    group_key: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'default' },
    quantity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 }
  }, {
    tableName: 'service_cart_items',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });
  return ServiceCartItem;
};
