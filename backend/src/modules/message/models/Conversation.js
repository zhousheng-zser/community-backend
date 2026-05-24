'use strict';

module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define('Conversation', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'private' },
    last_message_preview: { type: DataTypes.STRING(255), allowNull: true }
  }, {
    tableName: 'conversations',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return Conversation;
};
