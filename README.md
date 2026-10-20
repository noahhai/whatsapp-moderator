# WhatsApp Group Moderator

A automated WhatsApp group moderation system using WAHA (WhatsApp HTTP API) and Convex. This system automatically tracks user message counts in a sliding window and enforces quotas to prevent spam.

## Features

- **Sliding Window Quota System**: Track messages and images in a 7-day rolling window
- **Configurable Limits**: 20 messages + 20 images per user per week
- **Single Group Targeting**: Configure moderation for only one specific chat group
- **[AUTOMOD] Prefix**: All automated messages are clearly marked to distinguish from personal messages
- **Self-Message Exclusion**: The bot won't moderate its own messages
- **Automatic Warnings**: Users get warned at 90% of their quota (18/20 messages or images)
- **Automatic Deletion**: Messages exceeding quota are automatically deleted
- **Reset Notifications**: Users are informed when their quota will reset
- **Audit Logging**: All moderation actions are logged for review
- **Easy Deployment**: Simple deployment to Convex and Koyeb using justfile
- **Automatic Environment Loading**: .env files are automatically loaded for all commands

## Architecture

```
WhatsApp Group → WAHA (Koyeb) → Convex Webhooks → Moderation Logic → Response Actions
```

1. **WAHA**: Handles WhatsApp Web API communication
2. **Convex**: Backend database and serverless functions
3. **Moderation System**: Sliding window algorithm and quota enforcement

## Quick Start

### Prerequisites

- Node.js (v18+)
- Convex account
- Koyeb account
- `just` command runner

### Installation

1. Clone and setup:
```bash
git clone <repository>
cd whatsapp-moderator
just quickstart
```

2. Fill in your `.env` file with actual values:
```bash
# Convex Configuration
CONVEX_DEPLOY_KEY=your-convex-deploy-key
CONVEX_WEBHOOK_URL=https://your-convex-deployment.convex.site

# WAHA Configuration
WAHA_URL=https://your-waha-instance.koyeb.app
WAHA_TOKEN=your-waha-api-token
```

3. Setup and deploy:
```bash
just setup       # Install dependencies and sync environment
just deploy-all  # Deploy both services (env automatically loaded)
```

### Setup Steps

1. **Deploy Convex**:
   ```bash
   just deploy-convex
   ```

2. **Deploy WAHA to Koyeb**:
   ```bash
   just deploy-waha
   ```

3. **Configure WAHA Session**:
   - Visit your WAHA instance URL
   - Scan QR code with WhatsApp
   - Configure webhook settings

## Configuration

### Moderation Settings

Configure the moderator behavior after deployment:

```bash
# Target a specific chat group only
npx convex run moderation:setTargetChatId --chatId "120363123456789012@g.us"

# Remove chat restriction (moderate all groups)
npx convex run moderation:setTargetChatId

# Enable/disable moderation globally
npx convex run moderation:setModerationEnabled --enabled true
npx convex run moderation:setModerationEnabled --enabled false

# Check current configuration
npx convex run moderation:getConfiguration

# View user statistics
npx convex run moderation:getModerationStats
```

### Quota Limits

Edit `convex/utils.ts` to modify limits:

```typescript
export const WEEKLY_MESSAGE_LIMIT = 20;  // Messages per week
export const WEEKLY_IMAGE_LIMIT = 20;    // Images per week
export const WARNING_THRESHOLD = 0.9;    // Warning at 90%
export const SLIDING_WINDOW_DAYS = 7;    // 7-day window
```

### Message Types

The system tracks:
- **Text messages**: Regular chat messages
- **Images**: Photos, stickers, and other image content

## Usage

### Justfile Commands

```bash
# Development
just dev                 # Start Convex development server (env auto-loaded)
just install            # Install dependencies

# Deployment
just deploy-convex      # Deploy to Convex (env auto-loaded)
just deploy-waha        # Deploy WAHA to Koyeb (env auto-loaded)
just deploy-all         # Deploy both services

# Environment Management
just setup              # Install dependencies and sync environment to Convex
just env-sync           # Sync .env variables to Convex
just env-list           # List Convex environment variables
just create-env         # Create .env template
just quickstart         # Complete quick start

# Management
just status             # Check deployment status
just logs-waha          # View WAHA logs
just test-webhook       # Test webhook connectivity
```

### API Endpoints

**Webhook Endpoint**: `POST /webhooks/waha`
- Receives WAHA webhook payloads
- Processes messages and enforces quotas

**Status Endpoint**: `GET /webhooks/status`
- Health check for webhook service

## Database Schema

### Tables

1. **messages**: Individual message tracking
   - `userId`: WhatsApp user ID
   - `messageId`: WhatsApp message ID
   - `timestamp`: Unix timestamp
   - `messageType`: "text" or "image"
   - `deleted`: Moderation status

2. **userStats**: User quota tracking
   - `userId`: WhatsApp user ID
   - `messageCount`: Current count in window
   - `imageCount`: Current image count
   - `quotaResetDate`: Next reset timestamp

3. **moderationLogs**: Audit trail
   - `action`: "warning_sent", "message_deleted", etc.
   - `timestamp`: When action occurred
   - `details`: Additional information

## Moderation Logic

### Sliding Window Algorithm

The system maintains a 7-day sliding window:

1. **New Message**: When a message arrives
2. **Count Messages**: Count user's messages in last 7 days
3. **Check Quota**: Compare against limits
4. **Take Action**: Warn, delete, or allow

### Actions

- **90% Quota**: Send warning message
- **100% Quota**: Delete message and send notification
- **Weekly Reset**: All quotas reset every Monday

### Warning Messages

**Warning Message:**
```
[AUTOMOD] ⚠️ *WhatsApp Group Quota Warning* ⚠️

📝 Messages: 18/20 (90%)
🖼️ Images: 19/20 (95%)

🔄 Quota resets on: [Date]
📋 Please limit your messages to stay within the group guidelines.
```

**Quota Exceeded Message:**
```
[AUTOMOD] 🚫 *Message Deleted - Quota Exceeded* 🚫

📊 Current usage:
📝 Messages: 20/20
🖼️ Images: 20/20

🔄 Your quota will reset on: [Date]
📋 Please wait until then to send more messages.
```

## Deployment Details

### Convex Setup

1. Create Convex project
2. Configure webhook endpoints
3. Set up cron jobs for cleanup
4. Deploy functions and schema

### Koyeb Setup

1. Deploy WAHA container
2. Configure environment variables
3. Set up webhook URLs
4. Monitor logs and status

### Environment Variables

**Convex**:
- `WAHA_URL`: WAHA instance URL
- `WAHA_TOKEN`: WAHA API token

**Koyeb**:
- `WHATSAPP_HOOK_URL`: Convex webhook URL
- `WHATSAPP_HOOK_EVENTS`: message
- `WHATSAPP_START_SESSION`: default

## Monitoring

### Check Status
```bash
just status              # Overall status
just status-waha         # WAHA specific status
```

### View Logs
```bash
just logs-waha           # WAHA container logs
```

### Test Connectivity
```bash
just test-webhook        # Test webhook endpoint
```

## Troubleshooting

### Common Issues

1. **Webhook Not Receiving Messages**:
   - Check WAHA webhook configuration
   - Verify Convex deployment URL
   - Test webhook endpoint

2. **Messages Not Being Deleted**:
   - Check WAHA API token
   - Verify deletion permissions
   - Review moderation logs

3. **Quota Not Resetting**:
   - Check cron job configuration
   - Verify weekly reset function
   - Review system logs

### Debug Commands

```bash
# Test webhook
curl -X GET "$CONVEX_WEBHOOK_URL/webhooks/status"

# Check WAHA health
curl "$WAHA_URL/health"

# View recent logs
just logs-waha
```

## Security Considerations

- Store API tokens securely
- Use HTTPS for all communications
- Regularly rotate access tokens
- Monitor for unusual activity
- Review moderation logs

## Contributing

1. Fork the repository
2. Create feature branch
3. Test thoroughly
4. Submit pull request

## License

MIT License - see LICENSE file for details.