import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
    DynamoDBDocumentClient, 
    GetCommand, 
    PutCommand, 
    UpdateCommand, 
    DeleteCommand, 
    QueryCommand,
    GetCommandInput,
    PutCommandInput,
    UpdateCommandInput,
    DeleteCommandInput,
    QueryCommandInput
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Configure AWS SDK v3
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-2'
});

const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'Shop';

// CORS headers
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Content-Type': 'application/json'
};

// Product interface
interface Product {
    ID: string;
    Name: string;
    Category: string;
    Price: number;
    Status?: string;
    Description?: string;
    ImageURL?: string;
    Stock?: number;
    Tags?: string[];
    CreatedAt?: number; // Changed to numeric timestamp
    UpdatedAt?: number; // Changed to numeric timestamp
    [key: string]: any; // Allow additional attributes
}

// Response helper
const response = (statusCode: number, body: any): APIGatewayProxyResult => ({
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
});

// Error handler
const handleError = (error: any, operation: string): APIGatewayProxyResult => {
    console.error(`Error in ${operation}:`, error);
    return response(500, {
        error: 'Internal Server Error',
        message: error.message,
        operation
    });
};

// Main Lambda handler
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Event:', JSON.stringify(event, null, 2));
    
    try {
        const method = event.httpMethod;
        const pathParams = event.pathParameters || {};
        const queryParams = event.queryStringParameters || {};
        const body = event.body ? JSON.parse(event.body) : {};

        // Handle OPTIONS for CORS
        if (method === 'OPTIONS') {
            return response(200, {});
        }

        console.log('Path parameters:', pathParams);
        console.log('Resource path:', event.resource);
        console.log('HTTP method:', method);

        // Route requests
        switch (method) {
            case 'GET':
                if (pathParams.id || pathParams.productId) {
                    // Handle both /shop/{id} and /shop/products/product/{id} patterns
                    const productId = pathParams.id || pathParams.productId;
                    if (!productId) {
                        return response(400, { error: 'Product ID is required' });
                    }
                    return await getProduct(productId);
                } else if (queryParams.category) {
                    // TODO: evaluate if we actually use this
                    return await getProductsByCategory(queryParams.category, queryParams);
                } else if (queryParams.status) {
                    // TODO: evaluate if we actually use this
                    return await getProductsByStatus(queryParams.status, queryParams);
                } else {
                    // Default to getting available products using the efficient Status-small-index GSI
                    return await getProductsByStatus('available', queryParams);
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
async function getProduct(id: string): Promise<APIGatewayProxyResult> {
    try {
        const params: GetCommandInput = {
            TableName: TABLE_NAME,
            Key: { ID: id }
        };
        
        const result = await dynamodb.send(new GetCommand(params));
        
        if (!result.Item) {
            return response(404, { error: 'Product not found' });
        }
        
        return response(200, result.Item);
    } catch (error) {
        return handleError(error, 'getProduct');
    }
}


// Get products by category using GSI
async function getProductsByCategory(category: string, queryParams: Record<string, string | undefined>): Promise<APIGatewayProxyResult> {
    try {
        const params: QueryCommandInput = {
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
        
        const result = await dynamodb.send(new QueryCommand(params));
        
        const responseBody: any = {
            products: result.Items || [],
            count: result.Items?.length || 0,
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
async function getProductsByStatus(status: string, queryParams: Record<string, string | undefined>): Promise<APIGatewayProxyResult> {
    try {
        const params: QueryCommandInput = {
            TableName: TABLE_NAME,
            IndexName: 'Status-small-index',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: {
                '#status': 'Status'
            },
            ExpressionAttributeValues: {
                ':status': status
            }
            // Note: No ScanIndexForward as Status-small-index has no sort key
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
            const expressionAttributeValues = params.ExpressionAttributeValues || {};
            
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
            params.ExpressionAttributeValues = expressionAttributeValues;
        }
        
        const result = await dynamodb.send(new QueryCommand(params));
        
        const responseBody: any = {
            products: result.Items || [],
            count: result.Items?.length || 0,
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
async function createProduct(productData: Partial<Product>): Promise<APIGatewayProxyResult> {
    try {
        // Validate required fields
        if (!productData.Name || !productData.Category || !productData.Price) {
            return response(400, {
                error: 'Missing required fields',
                required: ['Name', 'Category', 'Price']
            });
        }
        
        // Generate ID and Unix timestamp (seconds)
        const timestamp = Math.floor(Date.now() / 1000);
        const id = `product_${timestamp}_${Math.random().toString(36).substring(2, 11)}`;
        
        const product: Product = {
            ID: id,
            Name: productData.Name,
            Category: productData.Category,
            Price: parseFloat(productData.Price.toString()),
            Status: productData.Status || 'available',
            Description: productData.Description || '',
            ImageURL: productData.ImageURL || '',
            Stock: productData.Stock || 0,
            Tags: productData.Tags || [],
            CreatedAt: timestamp,
            UpdatedAt: timestamp,
            ...productData
        };
        
        const params: PutCommandInput = {
            TableName: TABLE_NAME,
            Item: product,
            ConditionExpression: 'attribute_not_exists(ID)'
        };
        
        await dynamodb.send(new PutCommand(params));
        
        return response(201, product);
    } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
            return response(409, { error: 'Product already exists' });
        }
        return handleError(error, 'createProduct');
    }
}

// Update existing product
async function updateProduct(id: string, updateData: Record<string, any>): Promise<APIGatewayProxyResult> {
    try {
        // Remove ID from update data if present
        delete updateData.ID;
        delete updateData.CreatedAt; // Prevent overwriting creation timestamp
        
        // Add Unix timestamp (seconds) for updated time
        updateData.UpdatedAt = Math.floor(Date.now() / 1000);
        
        // Build update expression
        const updateExpression: string[] = [];
        const expressionAttributeNames: Record<string, string> = {};
        const expressionAttributeValues: Record<string, any> = {};
        
        Object.keys(updateData).forEach(key => {
            updateExpression.push(`#${key} = :${key}`);
            expressionAttributeNames[`#${key}`] = key;
            expressionAttributeValues[`:${key}`] = updateData[key];
        });
        
        const params: UpdateCommandInput = {
            TableName: TABLE_NAME,
            Key: { ID: id },
            UpdateExpression: `SET ${updateExpression.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ConditionExpression: 'attribute_exists(ID)',
            ReturnValues: 'ALL_NEW'
        };
        
        const result = await dynamodb.send(new UpdateCommand(params));
        
        return response(200, result.Attributes);
    } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
            return response(404, { error: 'Product not found' });
        }
        return handleError(error, 'updateProduct');
    }
}

// Delete product
async function deleteProduct(id: string): Promise<APIGatewayProxyResult> {
    try {
        const params: DeleteCommandInput = {
            TableName: TABLE_NAME,
            Key: { ID: id },
            ConditionExpression: 'attribute_exists(ID)',
            ReturnValues: 'ALL_OLD'
        };
        
        const result = await dynamodb.send(new DeleteCommand(params));
        
        if (!result.Attributes) {
            return response(404, { error: 'Product not found' });
        }
        
        return response(200, {
            message: 'Product deleted successfully',
            deletedProduct: result.Attributes
        });
    } catch (error: any) {
        if (error.name === 'ConditionalCheckFailedException') {
            return response(404, { error: 'Product not found' });
        }
        return handleError(error, 'deleteProduct');
    }
}