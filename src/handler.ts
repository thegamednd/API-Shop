import { randomUUID } from 'crypto';
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
import { uploadProductImage, deleteProductFolder } from './services/imageUploadService.js';

// Configure AWS SDK v3
const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'eu-west-2'
});

const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'Shop';
const ACCOUNTS_TABLE_NAME = process.env.ACCOUNTS_TABLE_NAME || 'Accounts';
const GAMING_SYSTEMS_TABLE_NAME = process.env.GAMING_SYSTEMS_TABLE_NAME || 'GamingSystems';

// CORS headers
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Content-Type': 'application/json'
};

// Product interface - Updated for new Shop table structure
interface ProductItem {
    Type: 'Maps' | 'Classes' | 'Spells' | 'Races' | 'Modules' | 'Shop';
    ID?: string; // Required for Maps, Modules, and Shop, not needed for Classes/Spells/Races
}

interface Product {
    ID: string;
    Name: string;
    Items: ProductItem[]; // Array of items included in this product
    Price: number; // Price in cents (CAD) - e.g., 20000 = $200.00 CAD
    GamingSystemID: string;
    ShortDescription?: string; // Brief summary of the product
    Content?: string; // HTML/Markdown description
    Image?: string; // Image URL or key
    IsArchived: boolean;
    IsFeatured: boolean;
    GrantToNewAccounts: boolean; // If true, automatically grant this item to new accounts
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
 * - GET /shop/products/product/{id} - Get single product by ID (no auth required - for shop item references)
 * - GET /shop/systems/system/{id} - Get all products for a gaming system (no auth required)
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

        // Handle public /shop/products/product/{id} route (no auth required)
        if (method === 'GET' && path.includes('/shop/products/product/')) {
            const productId = pathParams.id || pathParams.productId;
            if (!productId) {
                return response(400, { error: 'Product ID is required' });
            }
            return await getProduct(productId);
        }

        // Handle public /shop/systems/system/{id} route (no auth required)
        // Returns all shop products for a given gaming system ID
        if (method === 'GET' && path.includes('/shop/systems/system/')) {
            const systemId = pathParams.id || pathParams.systemId;
            if (!systemId) {
                return response(400, { error: 'Gaming System ID is required' });
            }
            return await getProductsByGamingSystem(systemId, queryParams, event);
        }

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
                    return await getAllProducts(queryParams, isAdminRoute);
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
async function getProductsByGamingSystem(gamingSystemId: string, queryParams: Record<string, string | undefined>, _event?: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        const params: QueryCommandInput = {
            TableName: TABLE_NAME,
            IndexName: 'GamingSystemID-index',
            KeyConditionExpression: 'GamingSystemID = :gamingSystemId',
            ExpressionAttributeValues: {
                ':gamingSystemId': gamingSystemId
            }
        };

        // Check if request is from /realm/create page
        // Use query parameter since referer header may not be passed through API Gateway
        const isFromRealmCreate = queryParams.source === 'realm-create';

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
        let products = result.Items || [];

        // If request is from /realm/create and we're not already including archived,
        // check if we need to add "RealmForge Essentials" for this gaming system
        if (isFromRealmCreate && !includeArchived) {
            // Query for RealmForge Essentials (which may be archived)
            const essentialsParams: QueryCommandInput = {
                TableName: TABLE_NAME,
                IndexName: 'GamingSystemID-index',
                KeyConditionExpression: 'GamingSystemID = :gamingSystemId',
                FilterExpression: '#name = :essentialsName',
                ExpressionAttributeNames: {
                    '#name': 'Name'
                },
                ExpressionAttributeValues: {
                    ':gamingSystemId': gamingSystemId,
                    ':essentialsName': 'RealmForge Essentials'
                }
            };

            const essentialsResult = await dynamodb.send(new QueryCommand(essentialsParams));

            if (essentialsResult.Items && essentialsResult.Items.length > 0) {
                const essentialsProduct = essentialsResult.Items[0];
                // Add it if it's not already in the results
                const alreadyIncluded = products.some((p: any) => p.ID === essentialsProduct.ID);
                if (!alreadyIncluded) {
                    products = [essentialsProduct, ...products];
                }
            }
        }

        const responseBody: any = {
            products: products,
            count: products.length,
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
async function getAllProducts(queryParams: Record<string, string | undefined>, isAdminRoute: boolean = false): Promise<APIGatewayProxyResult> {
    try {
        const params: any = {
            TableName: TABLE_NAME
        };

        // For admin routes, include archived by default
        // For public routes, exclude archived by default
        // Query param can override either behavior
        const includeArchived = queryParams.includeArchived === 'true' ||
                               (queryParams.includeArchived !== 'false' && isAdminRoute);

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
async function createProduct(productData: any): Promise<APIGatewayProxyResult> {
    try {
        // Validate required fields
        if (!productData.Name || productData.Price === undefined || productData.Price === null || !productData.GamingSystemID || !productData.Items) {
            return response(400, {
                error: 'Missing required fields',
                required: ['Name', 'Items', 'Price', 'GamingSystemID']
            });
        }

        // Validate Items array
        if (!Array.isArray(productData.Items) || productData.Items.length === 0) {
            return response(400, {
                error: 'Items must be a non-empty array',
                message: 'At least one item is required'
            });
        }

        // Validate each item in Items array
        const validTypes = ['Maps', 'Classes', 'Spells', 'Races', 'Modules', 'Shop'];
        for (const item of productData.Items) {
            if (!item.Type || !validTypes.includes(item.Type)) {
                return response(400, {
                    error: 'Invalid item Type',
                    message: `Type must be one of: ${validTypes.join(', ')}`,
                    invalidItem: item
                });
            }

            // Maps, Modules, and Shop require ID
            if ((item.Type === 'Maps' || item.Type === 'Modules' || item.Type === 'Shop') && !item.ID) {
                return response(400, {
                    error: 'Missing ID for item',
                    message: `${item.Type} items require an ID`,
                    invalidItem: item
                });
            }

            // Validate ID format (basic UUID check)
            if (item.ID && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.ID)) {
                return response(400, {
                    error: 'Invalid ID format',
                    message: 'ID must be a valid UUID',
                    invalidItem: item
                });
            }
        }

        // Generate ID and ISO 8601 timestamp
        const timestamp = new Date().toISOString();
        const id = productData.ID || randomUUID();

        // Handle image upload if imageBase64 is provided
        let imagePath = productData.Image || '';
        if (productData.imageBase64) {
            console.log('Processing image upload during product creation');

            // Validate base64 image size (max 1MB original)
            const base64SizeBytes = (productData.imageBase64.length * 3) / 4;
            const maxSizeBytes = 1 * 1024 * 1024; // 1MB

            if (base64SizeBytes > maxSizeBytes) {
                return response(400, {
                    error: 'Image file too large (max 1MB)',
                    size: Math.round(base64SizeBytes / 1024) + 'KB'
                });
            }

            try {
                // Convert base64 to buffer
                const imageBuffer = Buffer.from(productData.imageBase64, 'base64');
                console.log(`Decoded image buffer: ${imageBuffer.length} bytes`);

                // Determine environment
                const stage = process.env.STAGE || 'prod';
                const environment: 'dev' | 'prod' = stage === 'dev' ? 'dev' : 'prod';

                // Process and upload image
                imagePath = await uploadProductImage(
                    imageBuffer,
                    productData.GamingSystemID,
                    id,
                    environment
                );

                console.log(`Image uploaded successfully: ${imagePath}`);
            } catch (uploadError: any) {
                console.error('Error uploading image:', uploadError);
                return response(500, {
                    error: 'Failed to upload image',
                    message: uploadError.message
                });
            }
        }

        const product: Product = {
            ID: id,
            Name: productData.Name,
            Items: productData.Items,
            GamingSystemID: productData.GamingSystemID,
            Price: parseInt(productData.Price.toString()), // Price should be in cents (CAD)
            ShortDescription: productData.ShortDescription || '',
            Content: productData.Content || '',
            Image: imagePath,
            IsArchived: productData.IsArchived ?? false,
            IsFeatured: productData.IsFeatured ?? false,
            GrantToNewAccounts: productData.GrantToNewAccounts ?? false,
            CreatedAt: timestamp,
            UpdatedAt: timestamp
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
        // Handle image upload if imageBase64 is provided
        if (updateData.imageBase64) {
            console.log('Processing image upload during product update');

            // Validate base64 image size (max 1MB original)
            const base64SizeBytes = (updateData.imageBase64.length * 3) / 4;
            const maxSizeBytes = 1 * 1024 * 1024; // 1MB

            if (base64SizeBytes > maxSizeBytes) {
                return response(400, {
                    error: 'Image file too large (max 1MB)',
                    size: Math.round(base64SizeBytes / 1024) + 'KB'
                });
            }

            try {
                // Get the product to retrieve GamingSystemID
                const getParams: GetCommandInput = {
                    TableName: TABLE_NAME,
                    Key: { ID: id }
                };
                const existingProduct = await dynamodb.send(new GetCommand(getParams));

                if (!existingProduct.Item) {
                    return response(404, { error: 'Product not found' });
                }

                // Convert base64 to buffer
                const imageBuffer = Buffer.from(updateData.imageBase64, 'base64');
                console.log(`Decoded image buffer: ${imageBuffer.length} bytes`);

                // Determine environment
                const stage = process.env.STAGE || 'prod';
                const environment: 'dev' | 'prod' = stage === 'dev' ? 'dev' : 'prod';

                // Process and upload image
                const imagePath = await uploadProductImage(
                    imageBuffer,
                    existingProduct.Item.GamingSystemID,
                    id,
                    environment
                );

                console.log(`Image uploaded successfully: ${imagePath}`);

                // Replace imageBase64 with the uploaded image path
                updateData.Image = imagePath;
                delete updateData.imageBase64;
                delete updateData.imageFilename;
                delete updateData.imageType;
            } catch (uploadError: any) {
                console.error('Error uploading image:', uploadError);
                return response(500, {
                    error: 'Failed to upload image',
                    message: uploadError.message
                });
            }
        } else {
            // Remove image-related fields if not updating image
            delete updateData.imageFilename;
            delete updateData.imageType;
        }

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
        // First, get the product to find its GamingSystemID
        const getParams: GetCommandInput = {
            TableName: TABLE_NAME,
            Key: { ID: id }
        };

        const productResult = await dynamodb.send(new GetCommand(getParams));

        if (!productResult.Item) {
            return response(404, { error: 'Product not found' });
        }

        const product = productResult.Item as Product;
        const gamingSystemId = product.GamingSystemID;

        // Scan Accounts table for any accounts that have this shop item in their Access map
        const accountsWithAccess: Array<{ ID: string; Email: string }> = [];
        let lastEvaluatedKey: Record<string, any> | undefined = undefined;

        do {
            const scanParams: any = {
                TableName: ACCOUNTS_TABLE_NAME,
                ProjectionExpression: 'ID, Email, #access',
                ExpressionAttributeNames: {
                    '#access': 'Access'
                }
            };

            if (lastEvaluatedKey) {
                scanParams.ExclusiveStartKey = lastEvaluatedKey;
            }

            const scanResult = await dynamodb.send(new ScanCommand(scanParams));

            if (scanResult.Items) {
                for (const account of scanResult.Items) {
                    const accessMap = account.Access as Record<string, string[]> | undefined;
                    if (accessMap && accessMap[gamingSystemId]) {
                        // Check if this shop item ID is in the array for this gaming system
                        if (accessMap[gamingSystemId].includes(id)) {
                            accountsWithAccess.push({
                                ID: account.ID as string,
                                Email: account.Email as string
                            });
                        }
                    }
                }
            }

            lastEvaluatedKey = scanResult.LastEvaluatedKey;
        } while (lastEvaluatedKey);

        // Check if any gaming system requires this shop item
        const gamingSystemsRequiringItem: Array<{ ID: string; Name: string }> = [];
        let gsLastEvaluatedKey: Record<string, any> | undefined = undefined;

        do {
            const gsScanParams: any = {
                TableName: GAMING_SYSTEMS_TABLE_NAME,
                ProjectionExpression: 'ID, #name, RequiredShopItem',
                ExpressionAttributeNames: {
                    '#name': 'Name'
                },
                FilterExpression: 'RequiredShopItem = :shopItemId',
                ExpressionAttributeValues: {
                    ':shopItemId': id
                }
            };

            if (gsLastEvaluatedKey) {
                gsScanParams.ExclusiveStartKey = gsLastEvaluatedKey;
            }

            const gsScanResult = await dynamodb.send(new ScanCommand(gsScanParams));

            if (gsScanResult.Items) {
                for (const system of gsScanResult.Items) {
                    gamingSystemsRequiringItem.push({
                        ID: system.ID as string,
                        Name: system.Name as string
                    });
                }
            }

            gsLastEvaluatedKey = gsScanResult.LastEvaluatedKey;
        } while (gsLastEvaluatedKey);

        // If any accounts have access OR gaming systems require this item, return 409 Conflict
        if (accountsWithAccess.length > 0 || gamingSystemsRequiringItem.length > 0) {
            const errors: string[] = [];

            if (gamingSystemsRequiringItem.length > 0) {
                const systemNames = gamingSystemsRequiringItem.map(s => s.Name).join(', ');
                errors.push(`This shop item is required by the following gaming system(s): ${systemNames}. Remove the RequiredShopItem setting from these gaming systems before deleting.`);
            }

            if (accountsWithAccess.length > 0) {
                errors.push(`${accountsWithAccess.length} account(s) still have access to this shop item. Remove access from these accounts before deleting.`);
            }

            return response(409, {
                error: 'Cannot delete product',
                message: errors.join(' '),
                accounts: accountsWithAccess,
                gamingSystems: gamingSystemsRequiringItem
            });
        }

        // No accounts have access and no gaming systems require it, proceed with deletion
        const deleteParams: DeleteCommandInput = {
            TableName: TABLE_NAME,
            Key: { ID: id },
            ConditionExpression: 'attribute_exists(ID)',
            ReturnValues: 'ALL_OLD'
        };

        const result = await dynamodb.send(new DeleteCommand(deleteParams));

        if (!result.Attributes) {
            return response(404, { error: 'Product not found' });
        }

        // Delete the S3 folder for this product (don't fail if this errors)
        const environment = (process.env.ENVIRONMENT || 'dev') as 'dev' | 'prod';
        await deleteProductFolder(gamingSystemId, id, environment);

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