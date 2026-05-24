'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class HomeDisplayItem extends Model {}

  HomeDisplayItem.init({
    kind: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: 'worker | service | service_provider'
    },
    target_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: '关联目标主键（技工为 user_id）'
    },
    title: { type: DataTypes.STRING(200), allowNull: true, defaultValue: '' },
    description: { type: DataTypes.STRING(500), allowNull: true, defaultValue: '' },
    cover: { type: DataTypes.STRING(500), allowNull: true, defaultValue: '' },
    sort: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
    community_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: '可选：限定展示小区，空则全站默认小区可见'
    }
  }, {
    sequelize,
    modelName: 'HomeDisplayItem',
    tableName: 'home_display_items',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return HomeDisplayItem;
};
