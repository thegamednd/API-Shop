const AWS = require('aws-sdk');

// Configure AWS SDK
const dynamodb = new AWS.DynamoDB.DocumentClient({
    region: process.env.AWS_REGION || 'eu-west-2'
});

const TABLE_NAME = process.env.TABLE_NAME || 'Shop-Products';

// CORS headers
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Content-Type': 'application/json'
};

// Response helper
const response = (statusCode, body) => ({
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
});

// Error handler
const handleError = (error, operation) => {
    console.error(`Error in ${operation}:`, error);
    return response(500, {
        error: 'Internal Server Error',
        message: error.message,
        operation
    });
};

// Main Lambda handler
exports.handler = async (event) => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    try {
        const method = event.httpMethod;
        const path = event.path;
        const pathParams = event.pathParameters || {};
        const queryParams = event.queryStringParameters || {};
        const body = event.body ? JSON.parse(event.body) : {};

        // Handle OPTIONS for CORS
        if (method === 'OPTIONS') {
            return response(200, {});
        }

        // Route requests
        switch (method) {
            case 'GET':
                if (pathParams.id) {
                    return await getProduct(pathParams.id);
                } else if (queryParams.category) {
                    return await getProductsByCategory(queryParams.category, queryParams);
                } else if (queryParams.status) {
                    return await getProductsByStatus(queryParams.status, queryParams);
                } else {
                    return await getAllProducts(queryParams);
                }
                
            case 'POST':
                return await createProduct(body);
                
            case 'PUT':
                if (pathParams.id) {
                    return await updateProduct(pathParams.id, body);
                } else {
                    return response(400, { error: 'Product ID is required for updates' });
                }
                
            case 'DELETE':
                if (pathParams.id) {
                    return await deleteProduct(pathParams.id);
                } else {
                    return response(400, { error: 'Product ID is required for deletion' });
                }
                
            default:
                return response(405, { error: 'Method not allowed' });
        }
    } catch (error) {
        return handleError(error, 'handler');
    }
};

// Get single product by ID
async function getProduct(id) {
    try {
        const params = {
            TableName: TABLE_NAME,
            Key: { ID: id }
        };
        
        const result = await dynamodb.get(params).promise();
        
        if (!result.Item) {
            return response(404, { error: 'Product not found' });
        }
        
        return response(200, result.Item);
    } catch (error) {
        return handleError(error, 'getProduct');
    }
}

// Get all products with optional pagination
async function getAllProducts(queryParams) {
    try {
        const params = {
            TableName: TABLE_NAME
        };
        
        // Add pagination if provided
        if (queryParams.lastKey) {
            params.ExclusiveStartKey = JSON.parse(decodeURIComponent(queryParams.lastKey));
        }
        
        if (queryParams.limit) {
            params.Limit = parseInt(queryParams.limit);
        }
        
        const result = await dynamodb.scan(params).promise();
        
        const responseBody = {
            products: result.Items,
            count: result.Items.length
        };
        
        if (result.LastEvaluatedKey) {
            responseBody.lastKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
        }
        
        return response(200, responseBody);
    } catch (error) {
        return handleError(error, 'getAllProducts');
    }
}

// Get products by category using GSI
async function getProductsByCategory(category, queryParams) {
    try {
        const params = {
            TableName: TABLE_NAME,
            IndexName: 'Category-CreatedAt-index',
            KeyConditionExpression: 'Category = :category',
            ExpressionAttributeValues: {
                ':category': category
            },
            ScanIndexForward: false // Sort by CreatedAt descending (newest first)
        };
        
        // Add pagination if provided
        if (queryParams.lastKey) {
            params.ExclusiveStartKey = JSON.parse(decodeURIComponent(queryParams.lastKey));
        }
        
        if (queryParams.limit) {
            params.Limit = parseInt(queryParams.limit);
        }
        
        const result = await dynamodb.query(params).promise();
        
        const responseBody = {
            products: result.Items,
            count: result.Items.length,
            category: category
        };
        
        if (result.LastEvaluatedKey) {
            responseBody.lastKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
        }
        
        return response(200, responseBody);
    } catch (error) {
        return handleError(error, 'getProductsByCategory');
    }
}

// Get products by status using GSI
async function getProductsByStatus(status, queryParams) {
    try {
        const params = {
            TableName: TABLE_NAME,
            IndexName: 'Status-Price-index',
            KeyConditionExpression: 'Status = :status',
            ExpressionAttributeValues: {
                ':status': status
            },
            ScanIndexForward: true // Sort by Price ascending (cheapest first)
        };
        
        // Add pagination if provided
        if (queryParams.lastKey) {
            params.ExclusiveStartKey = JSON.parse(decodeURIComponent(queryParams.lastKey));
        }
        
        if (queryParams.limit) {
            params.Limit = parseInt(queryParams.limit);
        }
        
        // Add price range filtering if provided
        if (queryParams.minPrice || queryParams.maxPrice) {
            let filterExpression = '';
            const expressionAttributeValues = params.ExpressionAttributeValues;
            
            if (queryParams.minPrice) {
                filterExpression += 'Price >= :minPrice';
                expressionAttributeValues[':minPrice'] = parseFloat(queryParams.minPrice);
            }
            
            if (queryParams.maxPrice) {
                if (filterExpression) filterExpression += ' AND ';
                filterExpression += 'Price <= :maxPrice';
                expressionAttributeValues[':maxPrice'] = parseFloat(queryParams.maxPrice);
            }
            
            params.FilterExpression = filterExpression;
        }
        
        const result = await dynamodb.query(params).promise();
        
        const responseBody = {
            products: result.Items,
            count: result.Items.length,
            status: status
        };
        
        if (result.LastEvaluatedKey) {
            responseBody.lastKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
        }
        
        return response(200, responseBody);
    } catch (error) {
        return handleError(error, 'getProductsByStatus');
    }
}

// Create new product
async function createProduct(productData) {
    try {
        // Validate required fields
        if (!productData.Name || !productData.Category || !productData.Price) {
            return response(400, {
                error: 'Missing required fields',
                required: ['Name', 'Category', 'Price']
            });
        }
        
        // Generate ID and timestamps
        const timestamp = new Date().toISOString();
        const id = `product_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const product = {
            ID: id,
            Name: productData.Name,
            Category: productData.Category,
            Price: parseFloat(productData.Price),
            Status: productData.Status || 'active',
            Description: productData.Description || '',
            ImageURL: productData.ImageURL || '',
            Stock: productData.Stock || 0,
            Tags: productData.Tags || [],
            CreatedAt: timestamp,
            UpdatedAt: timestamp,
            ...productData.additionalAttributes
        };
        
        const params = {
            TableName: TABLE_NAME,
            Item: product,
            ConditionExpression: 'attribute_not_exists(ID)'
        };
        
        await dynamodb.put(params).promise();
        
        return response(201, product);
    } catch (error) {
        if (error.code === 'ConditionalCheckFailedException') {
            return response(409, { error: 'Product already exists' });
        }
        return handleError(error, 'createProduct');
    }
}

// Update existing product
async function updateProduct(id, updateData) {
    try {
        // Remove ID from update data if present
        delete updateData.ID;
        delete updateData.CreatedAt; // Prevent overwriting creation timestamp
        
        // Add updated timestamp
        updateData.UpdatedAt = new Date().toISOString();
        
        // Build update expression
        const updateExpression = [];
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};
        
        Object.keys(updateData).forEach(key => {
            updateExpression.push(`#${key} = :${key}`);
            expressionAttributeNames[`#${key}`] = key;
            expressionAttributeValues[`:${key}`] = updateData[key];
        });
        
        const params = {
            TableName: TABLE_NAME,
            Key: { ID: id },
            UpdateExpression: `SET ${updateExpression.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ConditionExpression: 'attribute_exists(ID)',
            ReturnValues: 'ALL_NEW'
        };
        
        const result = await dynamodb.update(params).promise();
        
        return response(200, result.Attributes);
    } catch (error) {
        if (error.code === 'ConditionalCheckFailedException') {
            return response(404, { error: 'Product not found' });
        }
        return handleError(error, 'updateProduct');
    }
}

// Delete product
async function deleteProduct(id) {
    try {
        const params = {
            TableName: TABLE_NAME,
            Key: { ID: id },
            ConditionExpression: 'attribute_exists(ID)',
            ReturnValues: 'ALL_OLD'
        };
        
        const result = await dynamodb.delete(params).promise();
        
        if (!result.Attributes) {
            return response(404, { error: 'Product not found' });
        }
        
        return response(200, {
            message: 'Product deleted successfully',
            deletedProduct: result.Attributes
        });
    } catch (error) {
        if (error.code === 'ConditionalCheckFailedException') {
            return response(404, { error: 'Product not found' });
        }
        return handleError(error, 'deleteProduct');
    }
}