'use strict';

module.exports = (sequelize, DataTypes) => {
  const MerchantShopDeliveryBinding = sequelize.define('MerchantShopDeliveryBinding', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    shop_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      comment: 'merchant_shops.id / market_shops.id'
    },
    provider: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: 'meituan|eleme|dada|sf|shansong'
    },
    external_shop_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: '平台门店ID'
    },
    external_shop_code: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: '扩展编码'
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
      comment: 'active|pending|disabled'
    },
    bind_payload_json: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    tableName: 'merchant_shop_delivery_bindings',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { unique: true, fields: ['shop_id', 'provider'] },
      { fields: ['provider', 'external_shop_id'] }
    ]
  });

  return MerchantShopDeliveryBinding;
};
