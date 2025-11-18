#!/bin/bash
# Script to switch to staging environment locally

echo "🔄 Switching to staging environment..."

# Check if staging branch exists
if ! git show-ref --verify --quiet refs/heads/staging; then
    echo "❌ Staging branch doesn't exist. Creating it..."
    git checkout -b staging
    git push -u origin staging
fi

# Switch to staging branch
git checkout staging

# Check if .env.staging exists
if [ ! -f .env.staging ]; then
    echo "⚠️  .env.staging not found. Creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env.staging
        echo "✅ Created .env.staging. Please update it with staging credentials."
    else
        echo "❌ .env.example not found. Please create .env.staging manually."
    fi
fi

# Copy staging env to .env
if [ -f .env.staging ]; then
    cp .env.staging .env
    echo "✅ Loaded staging environment variables"
else
    echo "⚠️  .env.staging not found. Using existing .env"
fi

echo "✅ Switched to staging branch"
echo "📝 Remember to:"
echo "   1. Update .env with staging credentials"
echo "   2. Use staging Shopify app credentials"
echo "   3. Point to staging MongoDB database"
echo ""
echo "🚀 Ready to develop on staging!"

