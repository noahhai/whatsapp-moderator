import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getUserQuotaStatusHelper, getNextQuotaReset, formatTimeUntil } from "./utils";

// Mutation to process incoming message from WAHA webhook
export const processIncomingMessage = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.string(),
    messageId: v.string(),
    messageType: v.union(v.literal("text"), v.literal("image")),
    units: v.optional(v.number()),
    content: v.optional(v.string()),
    username: v.optional(v.string()),
    session: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();

    // Only photos are limited; texts are never counted or removed
    if (args.messageType !== "image") {
      return { action: "none" as const, shouldDelete: false, quotaStatus: null, warningMessage: null, quotaExceededMessage: null };
    }

    // WAHA can deliver the same message more than once; ignore repeats
    const duplicate = await ctx.db
      .query("messages")
      .withIndex("by_message_id", (q) => q.eq("messageId", args.messageId))
      .first();
    if (duplicate) {
      return {
        action: "none" as const,
        shouldDelete: false,
        quotaStatus: await getUserQuotaStatusHelper(ctx, { userId: args.userId, chatId: args.chatId }),
        warningMessage: null,
        quotaExceededMessage: null,
      };
    }

    // Store the message
    await ctx.db.insert("messages", {
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      timestamp,
      messageType: args.messageType,
      content: args.content,
      units: args.units,
      deleted: false,
    });

    // Update or create user stats for this chat
    const existingStats = await ctx.db
      .query("userStats")
      .withIndex("by_user_chat", (q) => q.eq("userId", args.userId).eq("chatId", args.chatId))
      .first();

    if (existingStats) {
      await ctx.db.patch(existingStats._id, {
        username: args.username || existingStats.username,
        lastMessageTime: timestamp,
      });
    } else {
      await ctx.db.insert("userStats", {
        userId: args.userId,
        chatId: args.chatId,
        username: args.username,
        messageCount: 0,
        imageCount: 0,
        lastMessageTime: timestamp,
        warningsSent: 0,
        quotaResetDate: getNextQuotaReset(),
      });
    }

    // Check quota status and take action
    const quotaStatus = await getUserQuotaStatusHelper(
      ctx,
      { userId: args.userId, chatId: args.chatId },
      args.units ?? 1
    );

    let action: "none" | "warning" | "delete" = "none";
    let shouldDelete = false;

    if (quotaStatus.exceedsQuota) {
      // Delete the message if quota is exceeded
      action = "delete";
      shouldDelete = true;

      await ctx.db
        .query("messages")
        .withIndex("by_message_id", (q) => q.eq("messageId", args.messageId))
        .first()
        .then(async (message) => {
          if (message) {
            await ctx.db.patch(message._id, { deleted: true });
          }
        });

      // Log the moderation action
      await ctx.db.insert("moderationLogs", {
        userId: args.userId,
        chatId: args.chatId,
        action: "message_deleted",
        messageId: args.messageId,
        timestamp,
        details: `Message deleted - quota exceeded. Type: ${args.messageType}`,
      });

      // Photos arrive one by one, so send ONE notice per burst: the first deletion
      // schedules it, later deletions within the batch window piggyback on it.
      const BATCH_MS = 6000;
      const burst = await ctx.db
        .query("moderationLogs")
        .withIndex("by_user_chat", (q) => q.eq("userId", args.userId).eq("chatId", args.chatId))
        .filter((q) => q.and(q.eq(q.field("action"), "quota_exceeded"), q.gte(q.field("timestamp"), timestamp - 30000)))
        .first();
      if (!burst) {
        await ctx.db.insert("moderationLogs", {
          userId: args.userId,
          chatId: args.chatId,
          action: "quota_exceeded",
          timestamp,
          details: "Notice scheduled",
        });
        await ctx.scheduler.runAfter(BATCH_MS, internal.notices.sendQuotaNotice, {
          userId: args.userId,
          chatId: args.chatId,
          session: args.session ?? "default",
          username: args.username,
          since: timestamp,
        });
      }

    } else if (quotaStatus.needsWarning) {
      // Send warning if approaching quota
      action = "warning";

      await ctx.db.insert("moderationLogs", {
        userId: args.userId,
        chatId: args.chatId,
        action: "warning_sent",
        messageId: args.messageId,
        timestamp,
        details: `Warning sent - approaching quota. Today ${quotaStatus.dayTotal}/${quotaStatus.dailyLimit}, week ${quotaStatus.weekTotal}/${quotaStatus.weeklyLimit}`,
      });
    }

    return {
      action,
      shouldDelete,
      quotaStatus,
      warningMessage: action === "warning" ? generateWarningMessage(quotaStatus) : null,
      quotaExceededMessage: null,
    };
  },
});

// Generate warning message for users approaching quota
function generateWarningMessage(q: any): string {
  return (
    "[AUTOMOD] ⚠️ *Photo quota warning* ⚠️\n\n" +
    `Today: ${q.dayTotal}/${q.dailyLimit} photos (Resets in ${formatTimeUntil(q.dayResetDate)})\n` +
    `This week: ${q.weekTotal}/${q.weeklyLimit} photos (Resets in ${formatTimeUntil(q.weekResetDate)})\n\n` +
    "Photos over the limit will be removed."
  );
}

// Query to get moderation statistics
export const getModerationStats = query({
  args: {
    userId: v.optional(v.string()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = args.days || 7;
    const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);

    let queryBuilder = ctx.db
      .query("moderationLogs")
      .withIndex("by_timestamp", (q) => q.gte("timestamp", startTime));

    if (args.userId) {
      queryBuilder = ctx.db
        .query("moderationLogs")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .filter((q) => q.gte(q.field("timestamp"), startTime));
    }

    const logs = await queryBuilder.collect();

    const stats = {
      totalActions: logs.length,
      warningsSent: logs.filter(l => l.action === "warning_sent").length,
      messagesDeleted: logs.filter(l => l.action === "message_deleted").length,
      quotaExceeded: logs.filter(l => l.action === "quota_exceeded").length,
    };

    return { stats, logs };
  },
});

// Mutation to manually reset a user's quota (admin function)
export const resetUserQuota = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // Delete all messages for this user
    const userMessages = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId!))
      .collect();

    for (const message of userMessages) {
      await ctx.db.delete(message._id);
    }

    // Reset user stats
    const userStats = await ctx.db
      .query("userStats")
      .withIndex("by_user", (q) => q.eq("userId", args.userId!))
      .first();

    if (userStats) {
      await ctx.db.patch(userStats._id, {
        messageCount: 0,
        imageCount: 0,
        warningsSent: 0,
        quotaResetDate: getNextQuotaReset(),
      });
    }

    return { success: true, message: "User quota reset successfully" };
  },
});

// Mutation to reset all user quotas (scheduled function for weekly reset)
export const resetAllUserQuotas = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all user stats
    const allUserStats = await ctx.db.query("userStats").collect();

    let resetCount = 0;

    for (const userStat of allUserStats) {
      // Delete all messages for this user
      const userMessages = await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", userStat.userId))
        .collect();

      for (const message of userMessages) {
        await ctx.db.delete(message._id);
      }

      // Reset the user stats
      await ctx.db.patch(userStat._id, {
        messageCount: 0,
        imageCount: 0,
        warningsSent: 0,
        quotaResetDate: getNextQuotaReset(),
      });

      resetCount++;
    }

    return {
      success: true,
      message: `Successfully reset quotas for ${resetCount} users`,
      resetCount
    };
  },
});

// Administrative function to configure target chat ID
export const setTargetChatId = mutation({
  args: { chatId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existingSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "targetChatId"))
      .first();

    const now = Date.now();

    if (args.chatId) {
      // Set target chat ID - only moderate this specific chat
      if (existingSetting) {
        await ctx.db.patch(existingSetting._id, {
          value: args.chatId,
          enabled: true,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("settings", {
          key: "targetChatId",
          value: args.chatId,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      return {
        success: true,
        message: `Moderation is now configured to only apply to chat: ${args.chatId}`,
      };
    } else {
      // Remove target chat ID - moderate all chats
      if (existingSetting) {
        await ctx.db.patch(existingSetting._id, {
          value: undefined,
          enabled: false,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("settings", {
          key: "targetChatId",
          value: undefined,
          enabled: false,
          createdAt: now,
          updatedAt: now,
        });
      }
      return {
        success: true,
        message: "Moderation is now enabled for all chats",
      };
    }
  },
});

// Administrative function to enable/disable moderation globally
export const setModerationEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, args) => {
    const existingSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "enabled"))
      .first();

    const now = Date.now();

    if (existingSetting) {
      // Update existing setting
      await ctx.db.patch(existingSetting._id, {
        value: args.enabled ? "true" : "false",
        enabled: args.enabled,
        updatedAt: now,
      });
    } else {
      // Create new setting
      await ctx.db.insert("settings", {
        key: "enabled",
        value: args.enabled ? "true" : "false",
        enabled: args.enabled,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      success: true,
      message: `Moderation is now ${args.enabled ? "enabled" : "disabled"}`,
    };
  },
});

// Query to get current configuration
export const getConfiguration = query({
  args: {},
  handler: async (ctx) => {
    const [enabledSetting, targetChatSetting] = await Promise.all([
      ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", "enabled"))
        .first(),
      ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", "targetChatId"))
        .first(),
    ]);

    return {
      enabled: enabledSetting?.enabled ?? true, // Default to enabled
      targetChatId: targetChatSetting?.value ?? null, // Default to all chats
      configuration: {
        status: enabledSetting?.enabled ? "active" : "disabled",
        scope: targetChatSetting?.value
          ? `Single chat: ${targetChatSetting.value}`
          : "All chats",
      },
    };
  },
});