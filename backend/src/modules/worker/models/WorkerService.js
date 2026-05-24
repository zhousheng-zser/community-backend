'use strict';

module.exports = (sequelize, DataTypes) => {
  const WorkerService = sequelize.define('WorkerService', {
    id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true
    },
    worker_user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: '所属技工用户ID'
    },
    service_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '关联平台服务 services.id'
    },
    enabled: {
      type: DataTypes.TINYINT,
      allowNull: false,
      defaultValue: 1
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    }
  }, {
    tableName: 'worker_services',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  WorkerService.associate = (models) => {
    if (models.Service) {
      WorkerService.belongsTo(models.Service, { foreignKey: 'service_id', as: 'service' });
    }
  };

  return WorkerService;
};
