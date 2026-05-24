'use strict';

module.exports = (sequelize, DataTypes) => {
  class ServiceProviderProfile extends sequelize.Sequelize.Model {
    static associate(models) {
      if (models.User) {
        ServiceProviderProfile.belongsTo(models.User, {
          foreignKey: 'user_id',
          as: 'user'
        });
      }
    }
  }

  ServiceProviderProfile.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    application_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: '所属用户ID'
    },
    shop_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: '',
      comment: '门店/服务商名称'
    },
    contact_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: '',
      comment: '联系人姓名'
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: '',
      comment: '联系电话'
    },
    license_url: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: ''
    },
    shop_front_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: '门店封面/门头照'
    },
    environment_url: {
      type: DataTypes.JSON,
      allowNull: true
    },
    id_card_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    certificate_url: {
      type: DataTypes.JSON,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active'
    },
    community_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: '服务小区'
    },
    balance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0
    },
    frozen_balance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0
    }
  }, {
    sequelize,
    modelName: 'ServiceProviderProfile',
    tableName: 'service_provider_profiles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id'] },
      { fields: ['status'] },
      { fields: ['community_id'] }
    ]
  });

  return ServiceProviderProfile;
};
