import { httpRouter } from "convex/server";
import { wahaWebhook, webhookStatus } from "./webhooks";

const http = httpRouter();

// Route for WAHA webhook messages
http.route({
  path: "/webhooks/waha",
  method: "POST",
  handler: wahaWebhook,
});

// Route for webhook health check
http.route({
  path: "/webhooks/status",
  method: "GET",
  handler: webhookStatus,
});

export default http;