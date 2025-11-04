import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
    QueryCommand,
    ScanCommand,
    GetCommandInput,
    PutCommandInput,
    UpdateCommandInput,
    DeleteCommandInput,
    QueryCommandInput
} from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { checkAuthentication } from './services/authService.js';
import { uploadProductImage } from './services/imageUploadService.js';

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
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Content-Type': 'application/json'
};

// Product interface - Updated for new Shop table structure
interface Product {
    ID: string;
    Name: string;
    Type: string; // e.g., "GamingSystems", "Spells", "Classes", "Rules"
    Price: number; // Price in cents (CAD) - e.g., 20000 = $200.00 CAD
    GamingSystemID: string;
    Content?: string; // HTML/Markdown description
    Image?: string; // Image URL or key
    IsArchived: boolean;
    IsFeatured: boolean;
    CreatedAt: string; // ISO 8601 timestamp
    UpdatedAt: string; // ISO 8601 timestamp
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

/**
 * Main Lambda handler for Shop API
 *
 * Public Routes:
 * - GET /shop - Get all active products
 * - GET /shop/{id} - Get single product by ID
 *
 * Admin Routes (requires Administrators group membership):
 * - GET /admin/shop - Get all products (including archived)
 * - GET /admin/shop/{id} - Get single product by ID
 * - POST /admin/shop - Create new product
 * - PUT /admin/shop/{id} - Update product
 * - PATCH /admin/shop/{id} - Partial update product
 * - DELETE /admin/shop/{id} - Delete product
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Event:', JSON.stringify(event, null, 2));

    try {
        const method = event.httpMethod;
        const pathParams = event.pathParameters || {};
        const queryParams = event.queryStringParameters || {};
        const path = event.path || event.resource || '';

        // Handle OPTIONS for CORS
        if (method === 'OPTIONS') {
            return response(200, {});
        }

        // Parse JSON body for all requests (now using JSON for image uploads too)
        const body = event.body ? JSON.parse(event.body) : {};

        console.log('Path parameters:', pathParams);
        console.log('Resource path:', event.resource);
        console.log('Path:', path);
        console.log('HTTP method:', method);

        // Check if this is an admin route
        const isAdminRoute = path.includes('/admin/shop');

        // If admin route, check authentication and authorization
        if (isAdminRoute) {
            const authResult = await checkAuthentication(event);

            if (authResult.statusCode !== 200) {
                return response(authResult.statusCode, {
                    error: authResult.message || 'Unauthorized'
                });
            }

            if (!authResult.isAdmin) {
                return response(403, {
                    error: 'Administrator access required'
                });
            }

            console.log('Admin authenticated:', authResult.userID);
        }

        // Route requests
        switch (method) {
            case 'GET':
                if (pathParams.id || pathParams.productId) {
                    // Handle both /shop/{id} and /admin/shop/{id} patterns
                    const productId = pathParams.id || pathParams.productId;
                    if (!productId) {
                        return response(400, { error: 'Product ID is required' });
                    }
                    return await getProduct(productId);
                } else if (queryParams.featured === 'true') {
                    // Get featured products only
                    return await getFeaturedProducts(queryParams);
                } else if (queryParams.gamingSystemId) {
                    // Get products by GamingSystemID
                    return await getProductsByGamingSystem(queryParams.gamingSystemId, queryParams);
                } else if (queryParams.type) {
                    // Get products by Type
                    return await getProductsByType(queryParams.type, queryParams);
                } else {
                    // Default to getting all products (admin can see archived too)
                    return await getAllProducts(queryParams);
                }

            case 'POST':
                // Check if this is an image upload request
                if (path.includes('/upload-image') || path.includes('upload-image')) {
                    return await handleImageUpload(body, isAdminRoute);
                }
                return await createProduct(body);

            case 'PUT':
                if (pathParams.id) {
                    return await updateProduct(pathParams.id, body);
                } else {
                    return response(400, { error: 'Product ID is required for updates' });
                }

            case 'PATCH':
                if (pathParams.id) {
                    return await updateProduct(pathParams.id, body);
                } else {
                    return response(400, { error: 'Product ID is required for partial updates' });
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

// Handle image upload (now accepts base64 encoded image in JSON body)
async function handleImageUpload(body: any, isAdminRoute: boolean): Promise<APIGatewayProxyResult> {
    try {
        // Only allow admin uploads
        if (!isAdminRoute) {
            return response(403, { error: 'Image uploads require administrator access' });
        }

        console.log('Processing image upload request');

        // Extract fields from JSON body
        const { imageBase64, imageFilename, imageType, productId, gamingSystemId } = body;

        if (!productId) {
            return response(400, { error: 'productId is required' });
        }

        if (!gamingSystemId) {
            return response(400, { error: 'gamingSystemId is required' });
        }

        if (!imageBase64) {
            return response(400, { error: 'imageBase64 is required' });
        }

        console.log(`Uploading image for product ${productId} in gaming system ${gamingSystemId}`);
        console.log(`Image filename: ${imageFilename}, type: ${imageType}`);

        // Convert base64 to buffer
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        console.log(`Decoded image buffer: ${imageBuffer.length} bytes`);

        // Determine environment
        // STAGE = 'dev' for dev environment, undefined for prod environment
        const stage = process.env.STAGE || 'prod';
        const environment: 'dev' | 'prod' = stage === 'dev' ? 'dev' : 'prod';

        // Process and upload image
        const imagePath = await uploadProductImage(
            imageBuffer,
            gamingSystemId,
            productId,
            environment
        );

        console.log(`Image uploaded successfully: ${imagePath}`);

        // Update product record with image path
        const updateParams: UpdateCommandInput = {
            TableName: TABLE_NAME,
            Key: { ID: productId },
            UpdateExpression: 'SET #image = :image, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
                '#image': 'Image',
                '#updatedAt': 'UpdatedAt'
            },
            ExpressionAttributeValues: {
                ':image': imagePath,
                ':updatedAt': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        };

        const result = await dynamodb.send(new UpdateCommand(updateParams));

        return response(200, {
            message: 'Image uploaded successfully',
            imagePath: imagePath,
            product: result.Attributes
        });
    } catch (error) {
        console.error('Error in handleImageUpload:', error);
        return handleError(error, 'handleImageUpload');
    }
}

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


// Get products by GamingSystemID using GSI
async function getProductsByGamingSystem(gamingSystemId: string, queryParams: Record<string, string | undefined>): Promise<APIGatewayProxyResult> {
    try {
        const params: QueryCommandInput = {
            TableName: TABLE_NAME,
            IndexName: 'GamingSystemID-index',
            KeyConditionExpression: 'GamingSystemID = :gamingSystemId',
            ExpressionAttributeValues: {
                ':gamingSystemId': gamingSystemId
            }
        };

        // Filter out archived products by default
        const includeArchived = queryParams.includeArchived === 'true';
        if (!includeArchived) {
            params.FilterExpression = 'IsArchived = :archived';
            params.ExpressionAttributeValues![':archived'] = false;
        }

        // Add pagination if provided
        if (queryParams.lastKey) {
            params.ExclusiveStartKey = JSON.parse(decodeURIComponent(queryParams.lastKey));
        }

        if (queryParams.limit) {
            params.Limit = parseInt(queryParams.limit);
        }

        // Add price range filtering if provided
        if (queryParams.minPrice || queryParams.maxPrice) {
            let filterExpr = params.FilterExpression || '';
            const expressionAttributeValues = params.ExpressionAttributeValues || {};

            if (queryParams.minPrice) {
                if (filterExpr) filterExpr += ' AND ';
                filterExpr += 'Price >= :minPrice';
                expressionAttributeValues[':minPrice'] = parseFloat(queryParams.minPrice);
            }

            if (queryParams.maxPrice) {
                if (filterExpr) filterExpr += ' AND ';
                filterExpr += 'Price <= :maxPrice';
                expressionAttributeValues[':maxPrice'] = parseFloat(queryParams.maxPrice);
            }

            params.FilterExpression = filterExpr;
            params.ExpressionAttributeValues = expressionAttributeValues;
        }

        const result = await dynamodb.send(new QueryCommand(params));

        const responseBody: any = {
            products: result.Items || [],
            count: result.Items?.length || 0,
            gamingSystemId: gamingSystemId
        };

        if (result.LastEvaluatedKey) {
            responseBody.lastKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
        }

        return response(200, responseBody);
    } catch (error) {
        return handleError(error, 'getProductsByGamingSystem');
    }
}

// Get all products with filtering
async function getAllProducts(queryParams: Record<string, string | undefined>): Promise<APIGatewayProxyResult> {
    try {
        const params: any = {
            TableName: TABLE_NAME
        };

        // Filter out archived products by default
        const includeArchived = queryParams.includeArchived === 'true';
        if (!includeArchived) {
            params.FilterExpression = 'IsArchived = :archived';
            params.ExpressionAttributeValues = { ':archived': false };
        }

        // Add Type filtering if provided
        if (queryParams.type) {
            const filterExpr = params.FilterExpression ? `${params.FilterExpression} AND #type = :type` : '#type = :type';
            params.FilterExpression = filterExpr;
            params.ExpressionAttributeNames = { '#type': 'Type' };
            params.ExpressionAttributeValues = params.ExpressionAttributeValues || {};
            params.ExpressionAttributeValues[':type'] = queryParams.type;
        }

        // Add pagination if provided
        if (queryParams.lastKey) {
            params.ExclusiveStartKey = JSON.parse(decodeURIComponent(queryParams.lastKey));
        }

        if (queryParams.limit) {
            params.Limit = parseInt(queryParams.limit);
        }

        const result = await dynamodb.send(new ScanCommand(params));

        const responseBody: any = {
            products: result.Items || [],
            count: result.Items?.length || 0
        };

        if (result.LastEvaluatedKey) {
            responseBody.lastKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
        }

        return response(200, responseBody);
    } catch (error) {
        return handleError(error, 'getAllProducts');
    }
}

// Get products by Type (for future optimization, could add a Type GSI)
async function getProductsByType(type: string, queryParams: Record<string, string | undefined>): Promise<APIGatewayProxyResult> {
    try {
        const params: any = {
            TableName: TABLE_NAME,
            FilterExpression: '#type = :type',
            ExpressionAttributeNames: {
                '#type': 'Type'
            },
            ExpressionAttributeValues: {
                ':type': type
            }
        };

        // Filter out archived products by default
        const includeArchived = queryParams.includeArchived === 'true';
        if (!includeArchived) {
            params.FilterExpression += ' AND IsArchived = :archived';
            params.ExpressionAttributeValues[':archived'] = false;
        }

        // Add pagination if provided
        if (queryParams.lastKey) {
            params.ExclusiveStartKey = JSON.parse(decodeURIComponent(queryParams.lastKey));
        }

        if (queryParams.limit) {
            params.Limit = parseInt(queryParams.limit);
        }

        const result = await dynamodb.send(new ScanCommand(params));

        const responseBody: any = {
            products: result.Items || [],
            count: result.Items?.length || 0,
            type: type
        };

        if (result.LastEvaluatedKey) {
            responseBody.lastKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
        }

        return response(200, responseBody);
    } catch (error) {
        return handleError(error, 'getProductsByType');
    }
}

// Create new product
async function createProduct(productData: Partial<Product>): Promise<APIGatewayProxyResult> {
    try {
        // Validate required fields
        if (!productData.Name || !productData.Type || !productData.Price || !productData.GamingSystemID) {
            return response(400, {
                error: 'Missing required fields',
                required: ['Name', 'Type', 'Price', 'GamingSystemID']
            });
        }

        // Check if GamingSystemID + Type combination already exists
        const uniqueCheckParams: QueryCommandInput = {
            TableName: TABLE_NAME,
            IndexName: 'GamingSystemID-Type-keys-index',
            KeyConditionExpression: 'GamingSystemID = :gamingSystemId AND #type = :type',
            ExpressionAttributeNames: {
                '#type': 'Type'
            },
            ExpressionAttributeValues: {
                ':gamingSystemId': productData.GamingSystemID,
                ':type': productData.Type
            },
            Limit: 1
        };

        const existingProduct = await dynamodb.send(new QueryCommand(uniqueCheckParams));

        if (existingProduct.Items && existingProduct.Items.length > 0) {
            return response(409, {
                error: 'Product with this Gaming System and Type combination already exists',
                existingProductId: existingProduct.Items[0].ID
            });
        }

        // Generate ID and ISO 8601 timestamp
        const timestamp = new Date().toISOString();
        const id = productData.ID || `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        const product: Product = {
            ID: id,
            Name: productData.Name,
            Type: productData.Type,
            GamingSystemID: productData.GamingSystemID,
            Price: parseInt(productData.Price.toString()), // Price should be in cents (CAD)
            Content: productData.Content || '',
            Image: productData.Image || '',
            IsArchived: productData.IsArchived ?? false,
            IsFeatured: productData.IsFeatured ?? false,
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

        // Add ISO 8601 timestamp for updated time
        updateData.UpdatedAt = new Date().toISOString();
        
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

// Get featured products with filtering
async function getFeaturedProducts(queryParams: Record<string, string | undefined>): Promise<APIGatewayProxyResult> {
    try {
        const params: any = {
            TableName: TABLE_NAME,
            FilterExpression: 'IsFeatured = :featured'
        };

        const expressionAttributeValues: Record<string, any> = {
            ':featured': true
        };

        // Filter out archived products by default
        const includeArchived = queryParams.includeArchived === 'true';
        if (!includeArchived) {
            params.FilterExpression += ' AND IsArchived = :archived';
            expressionAttributeValues[':archived'] = false;
        }

        params.ExpressionAttributeValues = expressionAttributeValues;

        // Add pagination if provided
        if (queryParams.lastKey) {
            params.ExclusiveStartKey = JSON.parse(decodeURIComponent(queryParams.lastKey));
        }

        if (queryParams.limit) {
            params.Limit = parseInt(queryParams.limit);
        }

        const result = await dynamodb.send(new ScanCommand(params));

        const responseBody: any = {
            products: result.Items || [],
            count: result.Items?.length || 0,
            featured: true
        };

        if (result.LastEvaluatedKey) {
            responseBody.lastKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
        }

        return response(200, responseBody);
    } catch (error) {
        return handleError(error, 'getFeaturedProducts');
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