#!/bin/bash
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_PROD="$MOBILE_DIR/.env.prod"

echo "📦 Overlord — Debug build to device (prod env)"
echo "================================================"

if [ ! -f "$ENV_PROD" ]; then
  echo "❌ Missing $ENV_PROD"
  exit 1
fi

echo "Supabase URL: $(grep EXPO_PUBLIC_SUPABASE_URL "$ENV_PROD" | cut -d= -f2)"
echo ""

cd "$MOBILE_DIR"
echo "🔨 Building Debug with production variables..."

# Expo CLI does not support selecting an arbitrary .env file for `run:ios`.
# Disable its automatic dotenv loading and provide the production vars explicitly.
set -a
source "$ENV_PROD"
set +a

EXPO_NO_DOTENV=1 npx expo run:ios --device --configuration Debug

echo ""
echo "✅ Debug build (prod backend) installed to device!"
