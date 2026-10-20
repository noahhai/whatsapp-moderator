import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getUserQuotaStatusHelper, formatTimeUntil, DAILY_LIMIT, WEEKLY_LIMIT } from "./utils";
import { sendWAHAMessage } from "./waha";

// How many messages were removed in this burst, plus current quota usage
export const burstSummary = internalQuery({
  args: { userId: v.string(), chatId: v.string(), since: v.number() },
  handler: async (ctx, args) => {
    const logs = await ctx.db
      .query("moderationLogs")
      .withIndex("by_user_chat", (q) => q.eq("userId", args.userId).eq("chatId", args.chatId))
      .filter((q) => q.and(q.eq(q.field("action"), "message_deleted"), q.gte(q.field("timestamp"), args.since)))
      .collect();
    const messageIds = logs.map((l) => l.messageId);
    let removedUnits = 0;
    for (const id of messageIds) {
      if (!id) continue;
      const msg = await ctx.db.query("messages").withIndex("by_message_id", (q) => q.eq("messageId", id)).first();
      removedUnits += msg?.units ?? 1;
    }
    const status = await getUserQuotaStatusHelper(ctx, { userId: args.userId, chatId: args.chatId });
    return { removed: removedUnits, status };
  },
});

// Sends ONE notice for a burst of removed messages
export const sendQuotaNotice = internalAction({
  args: {
    userId: v.string(),
    chatId: v.string(),
    session: v.string(),
    username: v.optional(v.string()),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const { removed, status } = await ctx.runQuery(internal.notices.burstSummary, {
      userId: args.userId,
      chatId: args.chatId,
      since: args.since,
    });
    if (removed === 0) return;
    const who = args.username && args.username !== "Unknown User" ? `${args.username}: ` : "";
    const text =
      `[AUTOMOD] 🚫 ${who}${removed} photo${removed === 1 ? "" : "s"} removed - quota reached\n\n` +
      `Today: ${status.dayTotal}/${status.dailyLimit} photos (Resets in ${formatTimeUntil(status.dayResetDate)})\n` +
      `This week: ${status.weekTotal}/${status.weeklyLimit} photos (Resets in ${formatTimeUntil(status.weekResetDate)})\n\n` +
      "To share more photos, please share a link to an album instead " +
      "(Google Photos shared album, or an iCloud Photos link: Photos app > Share > Copy iCloud Link).";
    await sendWAHAMessage(args.session, args.chatId, text);
  },
});

// One-time rules announcement. Run manually when moderation is switched on or the rules change:
//   npx convex run [--prod] notices:announceRules '{"chatId":"...@g.us"}'
export const announceRules = internalAction({
  args: { chatId: v.string(), session: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const text =
      "[AUTOMOD] 📱 *Group photo rules*\n\n" +
      "This group fills people's phones fast. Every photo gets saved to everyone's storage, and it adds up. " +
      "To keep that under control, we now limit photos per person:\n" +
      `• *${DAILY_LIMIT} photos per day*\n` +
      `• *${WEEKLY_LIMIT} photos per week*\n\n` +
      "Texts are never limited. Anything over the limit is removed automatically, " +
      "and you'll get a note saying when your quota resets.\n\n" +
      "*Want to share lots of photos?* Post a link to a shared album instead " +
      "(Google Photos shared album, or an iCloud Photos link: Photos app > Share > Copy iCloud Link). " +
      "Links don't use anyone's storage.";
    await sendWAHAMessage(args.session ?? "default", args.chatId, text);
  },
});
