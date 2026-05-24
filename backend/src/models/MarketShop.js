'use strict';

/** 与生产库 market_shops 表结构对齐（无 user_id） */
module.exports = (sequelize, DataTypes) => {
  const MarketShop = sequelize.define('MarketShop', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    shop_no: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: ''
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    logo_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    cover_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    notice: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    contact_name: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    contact_phone: {
      type: DataTypes.STRING(30),
      allowNull: true
    },
    business_hours: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    address: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    latitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true
    },
    longitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true
    },
    is_open: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1
    },
    is_active: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1
    }
  }, {
    tableName: 'market_shops',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return MarketShop;
};
