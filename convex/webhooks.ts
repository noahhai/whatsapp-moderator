import { httpAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { sendWAHAMessage, deleteWAHAMessage } from "./waha";

// HTTP action to handle WAHA webhooks.
// Logging is deliberately minimal: no payloads, bodies or phone numbers.
export const wahaWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload = await request.json();
    const { event, session = "default", payload: messagePayload } = payload;

    if (event !== "message" || !messagePayload) {
      return new Response("Event type not supported", { status: 200 });
    }

    const { id: messageId, from, fromMe, body, hasMedia, type, contact, participant } = messagePayload;

    // Skip messages from the bot itself
    if (fromMe) {
      return new Response("Skipping bot message", { status: 200 });
    }

    const chatId = from; // group id for group messages
    const isModerationEnabled = await ctx.runQuery(internal.utils.isModerationEnabledForChat, { chatId });
    if (!isModerationEnabled) {
      return new Response("Moderation not enabled for this chat", { status: 200 });
    }

    const userId = participant || from;
    const username = contact?.name || contact?.pushname || "Unknown User";

    // Photos/media vs. text; anything else is ignored
    let messageType: "text" | "image";
    if (
      hasMedia ||
      type === "image" ||
      type === "sticker" ||
      messagePayload._data?.Message?.imageMessage ||
      messagePayload._data?.Info?.MediaType === "image"
    ) {
      messageType = "image";
    } else if (type === "chat" || body || type === "text") {
      messageType = "text";
    } else {
      return new Response("Message type not supported", { status: 200 });
    }

    // A multi-photo album message counts once per photo
    const albumCount = messagePayload._data?.Message?.albumMessage?.expectedImageCount;
    const units = messageType === "image" && typeof albumCount === "number" && albumCount > 0 ? albumCount : 1;

    const result = await ctx.runMutation(internal.moderation.processIncomingMessage, {
      userId,
      chatId,
      messageId,
      messageType,
      units,
      content: body || "",
      username,
      session,
    });

    if (result.action === "warning" && result.warningMessage) {
      await sendWAHAMessage(session, from, result.warningMessage);
    }
    if (result.action === "delete") {
      // The "N photos removed" notice is batched and sent by notices.sendQuotaNotice
      await deleteWAHAMessage(session, from, messageId);
    }

    if (result.action !== "none") {
      console.log(`moderation: ${result.action} (${messageType})`);
    }

    return new Response(JSON.stringify({ success: true, action: result.action }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const err = error as Error;
    console.error("WAHA webhook error:", err?.message ?? "unknown");
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// HTTP action to get webhook status (health check)
export const webhookStatus = httpAction(async (ctx, request) => {
  return new Response(JSON.stringify({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "WhatsApp Moderator Webhook"
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
});