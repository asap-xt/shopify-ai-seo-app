#!/bin/bash
# Script to switch to production environment locally

echo "🔄 Switching to production environment..."

# Switch to main branch
git checkout main

# Check if .env.production exists
if [ ! -f .env.production ]; then
    echo "⚠️  .env.production not found. Creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env.production
        echo "✅ Created .env.production. Please update it with production credentials."
    else
        echo "❌ .env.example not found. Please create .env.production manually."
    fi
fi

# Copy production env to .env
if [ -f .env.production ]; then
    cp .env.production .env
    echo "✅ Loaded production environment variables"
else
    echo "⚠️  .env.production not found. Using existing .env"
fi

echo "✅ Switched to production branch"
echo "⚠️  WARNING: You are now on production branch!"
echo "📝 Remember to:"
echo "   1. Only merge tested code from staging"
echo "   2. Verify all environment variables"
echo "   3. Test thoroughly before deploying"
echo ""
echo "🚀 Ready to work on production!"

