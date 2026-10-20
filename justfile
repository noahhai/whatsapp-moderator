# WhatsApp Moderator Deployment Scripts

# Load environment variables from .env file if it exists
set dotenv-load

# Default recipe - show help
default:
    @just --list

# Install dependencies
install:
    npm install

# Setup project with dependencies and environment sync
setup: install
    @echo "🔧 Setting up project..."
    @if [ ! -f .env ]; then echo "⚠️  No .env file found. Run 'just create-env' first"; exit 1; fi
    @echo "📦 Installing dotenv-cli for environment management..."
    npm install
    @echo "🔄 Syncing environment variables to Convex..."
    npm run env:set
    @echo "✅ Setup complete! Run 'just dev' to start development"

# Run Convex development server
dev:
    #!/usr/bin/env bash
    set -euo pipefail

    # Load .env file if it exists
    if [ -f .env ]; then
        export $(grep -v '^#' .env | xargs)
    fi

    npx convex dev

# Deploy to Convex
deploy-convex:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🚀 Deploying to Convex..."

    # Load .env file if it exists
    if [ -f .env ]; then
        export $(grep -v '^#' .env | xargs)
    fi

    # Check if CONVEX_DEPLOY_KEY is set
    if [ -z "${CONVEX_DEPLOY_KEY:-}" ]; then
        echo "❌ CONVEX_DEPLOY_KEY not found in .env file"
        echo "Please ensure your .env file contains: CONVEX_DEPLOY_KEY=your-key"
        exit 1
    fi

    npx convex deploy
    echo "✅ Convex deployment complete!"
    echo "💡 Remember to sync environment variables with: just env-sync"

# Sync environment variables from .env to Convex
env-sync:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "🔄 Syncing environment variables to Convex..."

    # Load .env file if it exists
    if [ -f .env ]; then
        export $(grep -v '^#' .env | xargs)
    fi

    # Check required variables
    if [ -z "${WAHA_URL:-}" ] || [ -z "${WAHA_API_KEY:-}" ]; then
        echo "❌ WAHA_URL or WAHA_API_KEY not found in .env file"
        echo "Please ensure your .env file contains both variables"
        exit 1
    fi

    npx convex env set WAHA_URL "$WAHA_URL"
    npx convex env set WAHA_API_KEY "$WAHA_API_KEY"
    echo "✅ Environment variables synced to Convex!"

# List Convex environment variables
env-list:
    @echo "📋 Convex environment variables:"
    npm run env:list

# Build and deploy WAHA to Koyeb
deploy-waha:
    echo "🚀 Deploying WAHA to Koyeb..."
    @just _check-koyeb-vars
    koyeb service create whatsapp-moderator-waha \
        --app whatsapp-moderator \
        --docker devlikeapro/waha \
        --regions fra \
        --ports 3000:http \
        --env WHATSAPP_HOOK_URL={{env_var("CONVEX_WEBHOOK_URL")}}/webhooks/waha \
        --env WHATSAPP_HOOK_EVENTS=message \
        --env WHATSAPP_START_SESSION=default \
        --env WHATSAPP_SWAGGER_CONFIG_ADVANCED=true \
        --instance-type nano

# Update WAHA deployment on Koyeb
update-waha:
    echo "🔄 Updating WAHA deployment..."
    @just _check-koyeb-vars
    koyeb service update whatsapp-moderator/whatsapp-moderator-waha \
        --env WHATSAPP_HOOK_URL={{env_var("CONVEX_WEBHOOK_URL")}}/webhooks/waha

# Deploy both services
deploy-all: deploy-convex deploy-waha
    echo "✅ All services deployed successfully!"

# Get WAHA service status
status-waha:
    koyeb service get whatsapp-moderator/whatsapp-moderator-waha

# Get WAHA service logs
logs-waha:
    koyeb service logs whatsapp-moderator/whatsapp-moderator-waha --follow

# Delete WAHA service from Koyeb
cleanup-waha:
    echo "🗑️  Deleting WAHA service..."
    koyeb service delete whatsapp-moderator/whatsapp-moderator-waha

# Setup environment for development (legacy - use 'setup' instead)
setup-legacy:
    @echo "🔧 Setting up development environment..."
    @just install
    @echo ""
    @echo "⚠️  Please set up the following environment variables:"
    @echo "   CONVEX_DEPLOY_KEY - Your Convex deployment key"
    @echo "   CONVEX_WEBHOOK_URL - Your deployed Convex webhook URL"
    @echo "   WAHA_URL - Your WAHA instance URL"
    @echo "   WAHA_API_KEY - Your WAHA API token"
    @echo ""
    @echo "📝 Create a .env file with these variables for local development"
    @echo ""
    @echo "🚀 Run 'just dev' to start development"

# Check required environment variables for Koyeb deployment
_check-koyeb-vars:
    #!/usr/bin/env bash
    if [ -z "$CONVEX_WEBHOOK_URL" ]; then
        echo "❌ CONVEX_WEBHOOK_URL environment variable is required"
        echo "   This should be your deployed Convex webhook URL"
        exit 1
    fi

# Create .env template
create-env:
    @echo "📝 Creating .env template..."
    @echo "# Convex Configuration" > .env
    @echo "CONVEX_DEPLOY_KEY=your-convex-deploy-key" >> .env
    @echo "CONVEX_WEBHOOK_URL=https://your-convex-deployment.convex.site" >> .env
    @echo "" >> .env
    @echo "# WAHA Configuration" >> .env
    @echo "WAHA_URL=https://your-waha-instance.koyeb.app" >> .env
    @echo "WAHA_API_KEY=your-waha-api-token" >> .env
    @echo "" >> .env
    @echo "✅ Created .env template - please fill in your actual values"

# Test webhook connectivity
test-webhook:
    @echo "🧪 Testing webhook connectivity..."
    @if [ -n "$CONVEX_WEBHOOK_URL" ]; then \
        curl -X GET "$CONVEX_WEBHOOK_URL/webhooks/status" || echo "❌ Webhook test failed"; \
    else \
        echo "❌ CONVEX_WEBHOOK_URL not set"; \
    fi

# Show deployment status
status: status-waha
    @echo ""
    @echo "📊 Deployment Status:"
    @echo "   Convex: Check your Convex dashboard"
    @echo "   WAHA: See above"

# Quick start for new deployments
quickstart: create-env
    @echo ""
    @echo "🎉 Environment template created!"
    @echo ""
    @echo "Next steps:"
    @echo "1. Fill in your .env file with actual values"
    @echo "2. Run 'just setup' to install dependencies and sync environment"
    @echo "3. Run 'just deploy-all' to deploy both services"
    @echo "4. Configure your WAHA session via the web interface"
    @echo ""
    @echo "💡 Tip: Environment variables are now automatically loaded from .env!"