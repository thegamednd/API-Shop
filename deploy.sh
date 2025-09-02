#!/bin/bash

# API-Shop Deployment Script
# This script packages and deploys the Lambda function

set -e

echo "🚀 Starting API-Shop deployment..."

# Function name (update this to match your Lambda function name)
FUNCTION_NAME="api-shop"

# Create deployment package
echo "📦 Creating deployment package..."
zip -r api-shop.zip . -x '*.git*' 'node_modules/.cache/*' '*.zip' 'deploy.sh' 'dynamodb-table.json' 'README.md'

# Update Lambda function code
echo "🔄 Updating Lambda function code..."
aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://api-shop.zip

echo "✅ Deployment completed successfully!"

# Clean up
echo "🧹 Cleaning up..."
rm api-shop.zip

echo "🎉 API-Shop is now deployed!"