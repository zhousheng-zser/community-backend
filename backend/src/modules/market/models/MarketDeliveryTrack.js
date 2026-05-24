'use strict';

module.exports = (sequelize, DataTypes) => {
  const MarketDeliveryTrack = sequelize.define('MarketDeliveryTrack', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    job_id: { type: DataTypes.BIGINT, allowNull: false },
    order_no: { type: DataTypes.STRING(40), allowNull: false },
    status_code: { type: DataTypes.STRING(32), allowNull: false },
    status_text: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },
    note: { type: DataTypes.STRING(255), allowNull: true }
  }, {
    tableName: 'market_delivery_tracks',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });
  return MarketDeliveryTrack;
};
