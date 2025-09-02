# API-Shop

RealmForge Shop API - Product catalog and management system for the medieval-themed e-commerce platform.

## Overview

This AWS Lambda function provides a REST API for managing products in the RealmForge Shop. It supports full CRUD operations with advanced querying capabilities through DynamoDB Global Secondary Indexes.

## Features

- **Product Management**: Create, read, update, delete products
- **Category Filtering**: Query products by category with chronological sorting
- **Status Filtering**: Query products by status with price-based sorting
- **Price Range Filtering**: Filter products within specific price ranges
- **Pagination**: Support for paginated responses
- **CORS Support**: Cross-origin resource sharing enabled

## DynamoDB Table Structure

### Primary Table: `Shop-Products`

**Primary Key:**
- `ID` (String) - Unique product identifier

**Attributes:**
- `Name` (String) - Product name
- `Category` (String) - Product category (e.g., "weapons", "armor", "scrolls")
- `Price` (Number) - Product price
- `Status` (String) - Product status ("active", "inactive", "discontinued")
- `Description` (String) - Product description
- `ImageURL` (String) - Product image URL
- `Stock` (Number) - Available stock quantity
- `Tags` (List) - Product tags for search/filtering
- `CreatedAt` (String) - ISO timestamp of creation
- `UpdatedAt` (String) - ISO timestamp of last update

### Global Secondary Indexes

#### 1. Category-CreatedAt-index
- **Partition Key**: `Category` (String)
- **Sort Key**: `CreatedAt` (String)
- **Purpose**: Query products by category, sorted by creation date (newest first)
- **Projection**: All attributes

#### 2. Status-Price-index
- **Partition Key**: `Status` (String)
- **Sort Key**: `Price` (Number)
- **Purpose**: Query products by status, sorted by price (ascending)
- **Projection**: All attributes

## API Endpoints

### GET /products
Get all products with optional pagination

**Query Parameters:**
- `limit` - Maximum number of items to return
- `lastKey` - Pagination key for next page

### GET /products/{id}
Get a specific product by ID

### GET /products?category={category}
Get products by category, sorted by creation date (newest first)

**Query Parameters:**
- `category` - Product category to filter by
- `limit` - Maximum number of items to return
- `lastKey` - Pagination key for next page

### GET /products?status={status}
Get products by status, sorted by price (ascending)

**Query Parameters:**
- `status` - Product status to filter by
- `minPrice` - Minimum price filter
- `maxPrice` - Maximum price filter
- `limit` - Maximum number of items to return
- `lastKey` - Pagination key for next page

### POST /products
Create a new product

**Required Body Fields:**
- `Name` - Product name
- `Category` - Product category
- `Price` - Product price (number)

**Optional Body Fields:**
- `Status` - Product status (defaults to "active")
- `Description` - Product description
- `ImageURL` - Product image URL
- `Stock` - Stock quantity (defaults to 0)
- `Tags` - Array of tags

### PUT /products/{id}
Update an existing product

**Body:** Any product fields to update (except `ID` and `CreatedAt`)

### DELETE /products/{id}
Delete a product

## Environment Variables

- `TABLE_NAME` - DynamoDB table name (default: "Shop-Products")
- `AWS_REGION` - AWS region (default: "eu-west-2")

## Deployment

### Create DynamoDB Table
```bash
aws dynamodb create-table --cli-input-json file://dynamodb-table.json
```

### Deploy Lambda Function
```bash
npm run deploy
```

## Sample Product Data

```json
{
  "Name": "Legendary Sword of Dragon Slaying",
  "Category": "weapons",
  "Price": 299.99,
  "Status": "active",
  "Description": "A mystical blade forged in dragon fire, capable of slaying the mightiest beasts.",
  "ImageURL": "https://images.realmforge.io/weapons/dragon-sword.jpg",
  "Stock": 5,
  "Tags": ["legendary", "sword", "dragon", "weapon"]
}
```

## Error Handling

The API returns standard HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `404` - Not Found
- `409` - Conflict (duplicate)
- `500` - Internal Server Error

All errors include a descriptive error message in the response body.

## CORS

CORS is enabled for all origins (`*`) with support for:
- Headers: `Content-Type`, `X-Amz-Date`, `Authorization`, `X-Api-Key`, `X-Amz-Security-Token`
- Methods: `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`