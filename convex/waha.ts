// WAHA authenticates with an X-Api-Key header
function wahaHeaders(): Record<string, string> | null {
  const key = process.env.WAHA_API_KEY ?? process.env.WAHA_TOKEN;
  if (!process.env.WAHA_URL || !key) {
    console.error("WAHA_URL or WAHA_API_KEY not configured");
    return null;
  }
  return { "Content-Type": "application/json", "X-Api-Key": key };
}

export async function sendWAHAMessage(session: string, chatId: string, text: string) {
  const headers = wahaHeaders();
  if (!headers) return;
  try {
    const response = await fetch(`${process.env.WAHA_URL}/api/sendText`, {
      method: "POST",
      headers,
      body: JSON.stringify({ session, chatId, text }),
    });
    if (!response.ok) {
      console.error("Failed to send WAHA message:", response.status, await response.text());
    }
  } catch (error) {
    console.error("Error sending WAHA message:", error);
  }
}

// Delete a message for everyone (bot must be a group admin)
export async function deleteWAHAMessage(session: string, chatId: string, messageId: string) {
  const headers = wahaHeaders();
  if (!headers) return;
  try {
    const url = `${process.env.WAHA_URL}/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`;
    const response = await fetch(url, { method: "DELETE", headers });
    if (!response.ok) {
      console.error("Failed to delete WAHA message:", response.status, await response.text());
    }
  } catch (error) {
    console.error("Error deleting WAHA message:", error);
  }
}
