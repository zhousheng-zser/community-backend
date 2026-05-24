'use strict';

module.exports = (sequelize, DataTypes) => {
  const NeighborAssistOrder = sequelize.define('NeighborAssistOrder', {
    assist_type: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    community_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true
    },
    origin_address_snapshot: {
      type: DataTypes.JSON,
      allowNull: false
    },
    destination_address_snapshot: {
      type: DataTypes.JSON,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    appointment_time: {
      type: DataTypes.DATE,
      allowNull: true
    },
    remark: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'pending_pay'
    },
    pay_status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'unpaid'
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    contact_phone: {
      type: DataTypes.STRING(30),
      allowNull: true
    },
    assigned_worker_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    dispatch_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    dispatch_by: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    check_in_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    check_in_lat: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true
    },
    check_in_lng: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true
    },
    completion_proof_images: {
      type: DataTypes.JSON,
      allowNull: true
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    points_earned: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
      defaultValue: 0
    }
  }, {
    tableName: 'neighbor_assist_orders',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  NeighborAssistOrder.associate = (models) => {
    NeighborAssistOrder.belongsTo(models.User, { foreignKey: 'user_id', as: 'publisher' });
    NeighborAssistOrder.belongsTo(models.User, { foreignKey: 'user_id', as: 'buyer' });
    NeighborAssistOrder.belongsTo(models.User, { foreignKey: 'assigned_worker_id', as: 'assignedWorker' });
  };

  return NeighborAssistOrder;
};
