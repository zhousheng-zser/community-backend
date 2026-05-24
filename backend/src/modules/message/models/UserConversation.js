'use strict';

module.exports = (sequelize, DataTypes) => {
  const UserConversation = sequelize.define('UserConversation', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    conversation_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    peer_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    bot_type: { type: DataTypes.STRING(32), allowNull: true },
    unread_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'userconversations',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  UserConversation.associate = (models) => {
    if (models.Conversation) {
      UserConversation.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    }
    if (models.User) {
      UserConversation.belongsTo(models.User, { foreignKey: 'peer_id', as: 'peerUser', constraints: false });
    }
  };

  return UserConversation;
};
