'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PartnerCommissionBalance extends Model {
    static associate(models) {
      PartnerCommissionBalance.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    }
  }

  PartnerCommissionBalance.init({
    user_id: { type: DataTypes.BIGINT, allowNull: false },
    role: { type: DataTypes.STRING(32), allowNull: false },
    total_earned: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    available_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    withdrawn_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    pending_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 },
    frozen_amount: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0 }
  }, {
    sequelize,
    modelName: 'PartnerCommissionBalance',
    tableName: 'partner_commission_balances',
    underscored: true,
    timestamps: false,
    updatedAt: 'updated_at',
    indexes: [
      { unique: true, fields: ['user_id', 'role'] }
    ]
  });

  return PartnerCommissionBalance;
};
