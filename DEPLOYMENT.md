# WhatsApp Moderator Deployment Guide

## Prerequisites
- Node.js installed
- Convex CLI installed (`npm install -g convex`)
- Just command runner installed (`cargo install just` or see [just installation](https://just.systems/man/en/packages.html))
- Koyeb account (or alternative container platform)
- WhatsApp account for WAHA connection

## Quick Start

```bash
# 1. Create environment template
just quickstart

# 2. Fill in your .env file with actual values
# Edit .env with your preferred editor

# 3. Setup project and sync environment variables
just setup

# 4. Deploy both services
just deploy-all
```

## Step 1: Deploy Convex Backend

1. **Initialize and deploy Convex:**
   ```bash
   cd /Users/noahhaibach/repos/whatsapp-moderator
   npx convex deploy
   ```

2. **Note your Convex URL:**
   After deployment, you'll get a URL like: `https://your-project-123.convex.site`

## Step 2: Deploy WAHA Instance

1. **Deploy to Koyeb:**
   - Go to Koyeb dashboard
   - Create new service
   - Use Docker image: `devlikeapro/waha:plus`
   - Set environment variables:
     ```
     WAHA_WEBHOOK_URL=https://your-project-123.convex.site/webhooks/waha
     WAHA_WEBHOOK_EVENTS=message
     ```

2. **Note your WAHA URL:**
   After deployment, you'll get a URL like: `https://your-waha-app.koyeb.app`

3. **Generate WAHA API Token:**
   ```bash
   # Connect to WAHA and get your API token
   curl -X POST https://your-waha-app.koyeb.app/api/sessions/start \
     -H "Content-Type: application/json" \
     -d '{"name": "default"}'
   ```

## Step 3: Configure Convex Environment

1. **Set WAHA environment variables in Convex:**
   ```bash
   npx convex env set WAHA_URL https://your-waha-app.koyeb.app
   npx convex env set WAHA_TOKEN your-waha-api-token-here
   ```

2. **Redeploy Convex with new environment:**
   ```bash
   npx convex deploy
   ```

## Step 4: Configure WAHA Webhooks

1. **Set up webhook in WAHA to send to Convex:**
   ```bash
   curl -X POST https://your-waha-app.koyeb.app/api/webhooks \
     -H "Authorization: Bearer your-waha-api-token" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://your-project-123.convex.site/webhooks/waha",
       "events": ["message"]
     }'
   ```

## Step 5: Connect WhatsApp

1. **Start WhatsApp session in WAHA:**
   ```bash
   curl -X POST https://your-waha-app.koyeb.app/api/sessions/start \
     -H "Authorization: Bearer your-waha-api-token" \
     -H "Content-Type: application/json" \
     -d '{"name": "default"}'
   ```

2. **Get QR code to scan:**
   ```bash
   curl https://your-waha-app.koyeb.app/api/sessions/default/auth/qr \
     -H "Authorization: Bearer your-waha-api-token"
   ```

3. **Scan QR code with WhatsApp mobile app**

## Step 6: Configure Moderation Settings

1. **Set target chat ID (optional - for single group moderation):**
   ```bash
   # Use Convex dashboard or call the mutation directly
   # Replace with your actual group chat ID
   npx convex run moderation:setTargetChatId --chatId "your-group-id@g.us"
   ```

2. **Verify configuration:**
   ```bash
   npx convex run moderation:getConfiguration
   ```

## Testing

1. **Test webhook endpoint:**
   ```bash
   curl https://your-project-123.convex.site/webhooks/status
   ```

2. **Send a test message in your WhatsApp group**

3. **Check Convex logs for webhook activity**

## Environment Variables Summary

### Convex Environment (.env.local or Convex dashboard):
```
WAHA_URL=https://your-waha-app.koyeb.app
WAHA_TOKEN=your-waha-api-token-here
```

### WAHA Environment (Koyeb or your platform):
```
WAHA_WEBHOOK_URL=https://your-project-123.convex.site/webhooks/waha
WAHA_WEBHOOK_EVENTS=message
```

## Environment Variable Management

This project uses automatic .env file loading for all commands:

### Just Commands (Recommended)
```bash
# Environment variables are automatically loaded from .env
just dev                    # Start development with .env loaded
just deploy-convex         # Deploy with .env loaded
just env-sync              # Sync .env variables to Convex
just env-list              # List Convex environment variables
```

### NPM Scripts
```bash
# Environment variables are automatically loaded via dotenv-cli
npm run dev                 # Start development with .env loaded
npm run build              # Deploy with .env loaded
npm run env:set            # Sync .env variables to Convex
npm run env:list           # List Convex environment variables
```

### Manual Environment Loading (if needed)
```bash
# Load .env manually in your shell
source .env
# Then run commands that need environment variables
```

## Configuration Commands

After deployment, use these commands to configure the moderator:

```bash
# Enable moderation
npx convex run moderation:setModerationEnabled --enabled true

# Set target chat (for single group moderation)
npx convex run moderation:setTargetChatId --chatId "120363123456789012@g.us"

# Remove target chat restriction (moderate all groups)
npx convex run moderation:setTargetChatId

# Check current configuration
npx convex run moderation:getConfiguration

# View user quota status
npx convex run moderation:getModerationStats
```

## Troubleshooting

1. **Webhook not receiving messages:**
   - Check WAHA webhook configuration
   - Verify Convex webhook URL is accessible
   - Check WAHA and Convex logs

2. **Messages not being moderated:**
   - Check if moderation is enabled: `npx convex run moderation:getConfiguration`
   - Verify target chat ID matches your group ID
   - Check that bot account is admin in the group

3. **Cannot delete messages:**
   - Ensure WAHA session is connected
   - Verify WAHA_TOKEN is correct
   - Check that bot account has admin privileges in WhatsApp group