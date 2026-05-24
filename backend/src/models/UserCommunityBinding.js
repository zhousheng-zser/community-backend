'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserCommunityBinding = sequelize.define('UserCommunityBinding', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: '用户ID'
    },
    community_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: '社区ID'
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'user_community_bindings',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'community_id']
      }
    ]
  });

  UserCommunityBinding.associate = function(models) {
    UserCommunityBinding.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
    UserCommunityBinding.belongsTo(models.Community, { foreignKey: 'community_id', as: 'community' });
  };

  return UserCommunityBinding;
};