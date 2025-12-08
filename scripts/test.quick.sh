#!/usr/bin/env bash
# Quick test script - runs only Jest tests without database/E2E setup
# Usage: ./scripts/test-quick.sh

set -e

echo "🚀 Running quick tests (Jest unit tests only)..."
echo ""

npm test

echo ""
echo "✅ Quick tests completed!"
