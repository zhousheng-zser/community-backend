'use strict';

module.exports = (sequelize, DataTypes) => {
  const WorkerProfile = sequelize.define('WorkerProfile', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false,
      comment: '技工用户ID'
    },
    application_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      comment: '来源入驻申请ID'
    },
    community_id: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      comment: '服务小区ID'
    },
    real_name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: ''
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: ''
    },
    industry: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: ''
    },
    education: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    city: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    resume: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    id_card_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    work_photo_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: '工作台封面/工作生活照'
    },
    certificate_url: {
      type: DataTypes.JSON,
      allowNull: true,
      get() {
        const raw = this.getDataValue('certificate_url');
        if (raw == null) return [];
        if (Array.isArray(raw)) return raw;
        try {
          return JSON.parse(raw);
        } catch (e) {
          return raw ? [raw] : [];
        }
      },
      set(val) {
        if (Array.isArray(val)) {
          this.setDataValue('certificate_url', val);
        } else if (val == null) {
          this.setDataValue('certificate_url', null);
        } else {
          this.setDataValue('certificate_url', val);
        }
      }
    },
    main_direction: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    gender: {
      type: DataTypes.STRING(10),
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
      comment: 'active/inactive'
    }
  }, {
    tableName: 'worker_profiles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      { fields: ['user_id'] },
      { fields: ['community_id', 'status'] },
      { fields: ['application_id'] }
    ]
  });

  return WorkerProfile;
};
