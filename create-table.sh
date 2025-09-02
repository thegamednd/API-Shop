#!/bin/bash

# Create DynamoDB table for API-Shop
# This script creates the Shop-Products table with the required GSIs

set -e

echo "🗄️ Creating DynamoDB table: Shop-Products..."

# Create the table
aws dynamodb create-table --cli-input-json file://dynamodb-table.json

echo "⏳ Waiting for table to become active..."

# Wait for table to be active
aws dynamodb wait table-exists --table-name Shop-Products

echo "✅ Table created successfully!"

# Optional: Insert sample data
read -p "Would you like to insert sample product data? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    echo "📝 Inserting sample product data..."
    
    # Sample legendary weapon
    aws dynamodb put-item \
        --table-name Shop-Products \
        --item '{
            "ID": {"S": "product_legendary_sword_001"},
            "Name": {"S": "Dragon Slayer Sword"},
            "Category": {"S": "weapons"},
            "Price": {"N": "299.99"},
            "Status": {"S": "active"},
            "Description": {"S": "A legendary blade forged in dragon fire, capable of slaying the mightiest beasts."},
            "ImageURL": {"S": "https://images.realmforge.io/weapons/dragon-sword.jpg"},
            "Stock": {"N": "3"},
            "Tags": {"L": [{"S": "legendary"}, {"S": "sword"}, {"S": "dragon"}, {"S": "weapon"}]},
            "CreatedAt": {"S": "'$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")'"},
            "UpdatedAt": {"S": "'$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")'"}
        }'
    
    # Sample armor piece
    aws dynamodb put-item \
        --table-name Shop-Products \
        --item '{
            "ID": {"S": "product_armor_001"},
            "Name": {"S": "Plate Armor of Protection"},
            "Category": {"S": "armor"},
            "Price": {"N": "199.99"},
            "Status": {"S": "active"},
            "Description": {"S": "Heavy plate armor enchanted with protective magic."},
            "ImageURL": {"S": "https://images.realmforge.io/armor/plate-armor.jpg"},
            "Stock": {"N": "7"},
            "Tags": {"L": [{"S": "armor"}, {"S": "protection"}, {"S": "heavy"}]},
            "CreatedAt": {"S": "'$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")'"},
            "UpdatedAt": {"S": "'$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")'"}
        }'
    
    # Sample scroll
    aws dynamodb put-item \
        --table-name Shop-Products \
        --item '{
            "ID": {"S": "product_scroll_001"},
            "Name": {"S": "Scroll of Fireball"},
            "Category": {"S": "scrolls"},
            "Price": {"N": "49.99"},
            "Status": {"S": "active"},
            "Description": {"S": "A magical scroll containing the fireball spell."},
            "ImageURL": {"S": "https://images.realmforge.io/scrolls/fireball.jpg"},
            "Stock": {"N": "15"},
            "Tags": {"L": [{"S": "scroll"}, {"S": "magic"}, {"S": "fire"}, {"S": "spell"}]},
            "CreatedAt": {"S": "'$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")'"},
            "UpdatedAt": {"S": "'$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")'"}
        }'
    
    echo "✅ Sample data inserted successfully!"
fi

echo "🎉 Shop-Products table setup complete!"