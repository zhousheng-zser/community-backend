'use strict';

module.exports = (sequelize, DataTypes) => {
  const MarketDeliveryJob = sequelize.define('MarketDeliveryJob', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    order_no: { type: DataTypes.STRING(40), allowNull: false },
    shop_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    provider: { type: DataTypes.STRING(20), allowNull: false },
    external_order_no: { type: DataTypes.STRING(64), allowNull: true },
    job_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'created' },
    rider_name: { type: DataTypes.STRING(50), allowNull: true },
    rider_phone: { type: DataTypes.STRING(30), allowNull: true },
    fee_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    payload_json: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'market_delivery_jobs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });
  return MarketDeliveryJob;
};
