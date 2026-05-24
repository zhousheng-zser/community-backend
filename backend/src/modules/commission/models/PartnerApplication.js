'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class PartnerApplication extends Model {
    static associate(models) {
      if (models.User) {
        PartnerApplication.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
      }
    }
  }

  PartnerApplication.init({
    user_id: { type: DataTypes.BIGINT, allowNull: false },
    real_name: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
    phone: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '' },
    city: { type: DataTypes.STRING(50), allowNull: true, defaultValue: '' },
    remark: { type: DataTypes.STRING(500), allowNull: true, defaultValue: '' },
    role: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'promoter'
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'pending'
    },
    reject_reason: { type: DataTypes.STRING(255), allowNull: true }
  }, {
    sequelize,
    modelName: 'PartnerApplication',
    tableName: 'partner_applications',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return PartnerApplication;
};
