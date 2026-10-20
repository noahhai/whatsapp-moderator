import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Constants for quota limits
export const DAILY_LIMIT = 20; // Photos per rolling 24h (texts are not limited)
export const WEEKLY_LIMIT = 50; // Photos per rolling 7 days
export const WARNING_THRESHOLD = 0.75; // warn at 75% of either limit
export const SLIDING_WINDOW_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

// Get the timestamp for the start of the sliding window (7 days ago)
export function getSlidingWindowStart(): number {
  const now = Date.now();
  const sevenDaysAgo = now - (SLIDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return sevenDaysAgo;
}

// Calculate when the next quota reset will occur (next Monday at midnight)
export function getNextQuotaReset(): number {
  const now = new Date();
  const daysUntilMonday = (1 + 7 - now.getDay()) % 7 || 7;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday.getTime();
}

// Fetch the user's counted messages in the sliding window for a chat.
// Deleted messages and our own [AUTOMOD] messages don't count.
async function getCountedMessages(ctx: any, args: { userId: string; chatId: string }) {
  const windowStart = getSlidingWindowStart();
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_user_chat_and_timestamp", (q: any) =>
      q.eq("userId", args.userId).eq("chatId", args.chatId).gte("timestamp", windowStart)
    )
    .filter((q: any) => q.eq(q.field("deleted"), false))
    .collect();
  return messages.filter((m: any) => m.messageType === "image" && !m.content?.startsWith("[AUTOMOD]"));
}

// A message's weight against the quota. A multi-photo upload counts once per photo.
export function unitsOf(message: { units?: number }): number {
  return message.units ?? 1;
}

// Current quota status: a rolling 24h limit AND a rolling 7-day limit, texts + photos combined.
// `justAdded` is the weight of the message being processed, used to warn only once at the threshold crossing.
export async function getUserQuotaStatusHelper(
  ctx: any,
  args: { userId: string; chatId: string },
  justAdded = 0
) {
  const messages = await getCountedMessages(ctx, args); // already limited to the 7-day window
  const now = Date.now();
  const inDay = messages.filter((m: any) => m.timestamp >= now - DAY_MS);
  const sum = (list: any[]) => list.reduce((n: number, m: any) => n + unitsOf(m), 0);
  const dayTotal = sum(inDay);
  const weekTotal = sum(messages);

  const crossed = (total: number, limit: number) => {
    const warnAt = Math.ceil(limit * WARNING_THRESHOLD);
    return total >= warnAt && total <= limit && total - justAdded < warnAt;
  };
  const needsWarning = crossed(dayTotal, DAILY_LIMIT) || crossed(weekTotal, WEEKLY_LIMIT);
  const dayExceeded = dayTotal > DAILY_LIMIT;
  const weekExceeded = weekTotal > WEEKLY_LIMIT;

  // When a slot frees up: the oldest counted message ages out of the exceeded window(s).
  const oldest = (list: any[]) => (list.length ? Math.min(...list.map((m: any) => m.timestamp)) : now);
  const dayResetDate = oldest(inDay) + DAY_MS;
  const weekResetDate = oldest(messages) + SLIDING_WINDOW_DAYS * DAY_MS;
  const quotaResetDate = Math.max(
    ...(dayExceeded ? [dayResetDate] : []),
    ...(weekExceeded ? [weekResetDate] : []),
    dayResetDate
  );

  return {
    dayTotal,
    weekTotal,
    dailyLimit: DAILY_LIMIT,
    weeklyLimit: WEEKLY_LIMIT,
    needsWarning,
    exceedsQuota: dayExceeded || weekExceeded,
    quotaResetDate,
    dayResetDate,
    weekResetDate,
  };
}

// "3h 12m" style duration until a timestamp
export function formatTimeUntil(ts: number): string {
  const mins = Math.max(1, Math.ceil((ts - Date.now()) / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return [d ? `${d}d` : "", h ? `${h}h` : "", m || (!d && !h) ? `${m}m` : ""].filter(Boolean).join(" ");
}

// Query to get user's current quota status in a specific chat (for external API)
export const getUserQuotaStatus = query({
  args: { userId: v.string(), chatId: v.string() },
  handler: async (ctx, args) => {
    return await getUserQuotaStatusHelper(ctx, args);
  },
});

// Mutation to clean up old messages outside the sliding window
export const cleanupOldMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const windowStart = getSlidingWindowStart();

    const oldMessages = await ctx.db
      .query("messages")
      .filter((q) => q.lt(q.field("timestamp"), windowStart))
      .collect();

    for (const message of oldMessages) {
      await ctx.db.delete(message._id);
    }

    return { deleted: oldMessages.length };
  },
});

// Query to get a setting value
export const getSetting = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    return setting;
  },
});

// Mutation to set a setting value
export const setSetting = mutation({
  args: {
    key: v.string(),
    value: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existingSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    const now = Date.now();

    if (existingSetting) {
      // Update existing setting
      await ctx.db.patch(existingSetting._id, {
        value: args.value,
        enabled: args.enabled ?? existingSetting.enabled,
        updatedAt: now,
      });
      return existingSetting._id;
    } else {
      // Create new setting
      const newSetting = await ctx.db.insert("settings", {
        key: args.key,
        value: args.value,
        enabled: args.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      });
      return newSetting;
    }
  },
});

// Query to check if moderation is enabled for a specific chat
export const isModerationEnabledForChat = internalQuery({
  args: { chatId: v.string() },
  handler: async (ctx, args) => {
    // Check if moderation is globally enabled
    const globalEnabled = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "enabled"))
      .first();

    if (!globalEnabled || !globalEnabled.enabled) {
      return false;
    }

    // Check if there's a target chat ID configured
    const targetChatIdSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "targetChatId"))
      .first();

    // If no target chat is configured, moderate all chats
    if (!targetChatIdSetting || !targetChatIdSetting.value) {
      return true;
    }

    // If target chat is configured, only moderate that specific chat
    return targetChatIdSetting.value === args.chatId;
  },
});