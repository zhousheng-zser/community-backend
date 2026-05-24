'use strict';

module.exports = (sequelize, DataTypes) => {
  const CommunityServiceArea = sequelize.define('CommunityServiceArea', {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },
    community_id: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    center_name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      defaultValue: ''
    },
    center_lat: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: false
    },
    center_lng: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: false
    },
    radius_meters: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 300
    },
    keywords: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active'
    }
  }, {
    tableName: 'community_service_areas',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  CommunityServiceArea.associate = (models) => {
    if (models.Community) {
      CommunityServiceArea.belongsTo(models.Community, { foreignKey: 'community_id', as: 'community' });
    }
  };

  return CommunityServiceArea;
};
