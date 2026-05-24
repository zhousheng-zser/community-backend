'use strict';

module.exports = (sequelize, DataTypes) => {
  const MerchantShop = sequelize.define('MerchantShop', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      comment: '所属用户ID'
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: '',
      comment: '店铺名称'
    },
    logo: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '店铺Logo'
    },
    logo_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '店铺Logo（别名）'
    },
    cover_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '店铺封面'
    },
    contact_name: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '联系人姓名'
    },
    contact_phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: '联系人电话'
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: '店铺地址'
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
      comment: '纬度'
    },
    longitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
      comment: '经度'
    },
    business_hours: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: '营业时间'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: '店铺简介'
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: '经营品类'
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      comment: '状态: pending/approved/rejected/inactive'
    },
    reject_reason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: '驳回原因'
    }
  }, {
    tableName: 'merchant_shops',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id'] },
      { fields: ['status'] },
      { fields: ['latitude', 'longitude'] }
    ]
  });

  return MerchantShop;
};
