'use strict';

module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define('Message', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    conversation_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    sender_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    msg_type: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'text' },
    content: { type: DataTypes.TEXT, allowNull: false }
  }, {
    tableName: 'messages',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false
  });

  Message.associate = (models) => {
    if (models.User) {
      Message.belongsTo(models.User, { foreignKey: 'sender_id', as: 'sender', constraints: false });
    }
  };

  return Message;
};
