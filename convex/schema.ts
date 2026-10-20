import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Track individual messages from users
  messages: defineTable({
    userId: v.string(), // WhatsApp user ID
    chatId: v.optional(v.string()), // WhatsApp chat/group ID (optional for migration)
    messageId: v.string(), // WhatsApp message ID
    timestamp: v.number(), // Unix timestamp
    messageType: v.union(v.literal("text"), v.literal("image")), // Type of message
    content: v.optional(v.string()), // Message content (for text messages)
    units: v.optional(v.number()), // Quota weight (photos in a multi-photo upload); defaults to 1
    deleted: v.boolean(), // Whether this message was deleted by moderation
  })
    .index("by_user", ["userId"])
    .index("by_user_and_timestamp", ["userId", "timestamp"])
    .index("by_user_chat_and_timestamp", ["userId", "chatId", "timestamp"])
    .index("by_chat", ["chatId"])
    .index("by_message_id", ["messageId"]),

  // Track user statistics and quota status per chat
  userStats: defineTable({
    userId: v.string(), // WhatsApp user ID
    chatId: v.optional(v.string()), // WhatsApp chat/group ID (optional for migration)
    username: v.optional(v.string()), // Display name
    messageCount: v.number(), // Current message count in sliding window
    imageCount: v.number(), // Current image count in sliding window
    lastMessageTime: v.optional(v.number()), // Last message timestamp
    warningsSent: v.number(), // Number of warnings sent this period
    quotaResetDate: v.number(), // When the quota will reset (weekly)
  })
    .index("by_user", ["userId"])
    .index("by_user_chat", ["userId", "chatId"])
    .index("by_chat", ["chatId"]),

  // Track moderation actions for audit purposes
  moderationLogs: defineTable({
    userId: v.string(),
    chatId: v.optional(v.string()), // WhatsApp chat/group ID (optional for migration)
    action: v.union(
      v.literal("warning_sent"),
      v.literal("message_deleted"),
      v.literal("quota_exceeded")
    ),
    messageId: v.optional(v.string()),
    timestamp: v.number(),
    details: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_chat", ["chatId"])
    .index("by_user_chat", ["userId", "chatId"])
    .index("by_timestamp", ["timestamp"]),

  // Configuration settings for the moderator
  settings: defineTable({
    key: v.string(), // Setting identifier (e.g., "targetChatId", "enabled")
    value: v.optional(v.string()), // Setting value
    enabled: v.boolean(), // Whether this setting is active
    createdAt: v.number(), // When this setting was created
    updatedAt: v.number(), // When this setting was last updated
  })
    .index("by_key", ["key"]),
});