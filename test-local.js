// Local test file for API-Shop Lambda function
const { handler } = require('./index');

// Test events
const testEvents = {
    // Test GET all products
    getAllProducts: {
        httpMethod: 'GET',
        path: '/products',
        pathParameters: {},
        queryStringParameters: {}
    },
    
    // Test GET product by ID
    getProductById: {
        httpMethod: 'GET',
        path: '/products/test-123',
        pathParameters: { id: 'test-123' },
        queryStringParameters: {}
    },
    
    // Test GET products by category
    getByCategory: {
        httpMethod: 'GET',
        path: '/products',
        pathParameters: {},
        queryStringParameters: { category: 'weapons' }
    },
    
    // Test POST new product
    createProduct: {
        httpMethod: 'POST',
        path: '/products',
        pathParameters: {},
        queryStringParameters: {},
        body: JSON.stringify({
            Name: 'Test Sword',
            Category: 'weapons',
            Price: 99.99,
            Description: 'A test weapon for development',
            Status: 'active',
            Stock: 10
        })
    },
    
    // Test OPTIONS for CORS
    optionsCors: {
        httpMethod: 'OPTIONS',
        path: '/products',
        pathParameters: {},
        queryStringParameters: {}
    }
};

// Run tests
async function runTests() {
    console.log('🧪 Running API-Shop Lambda tests...\n');
    
    for (const [testName, event] of Object.entries(testEvents)) {
        console.log(`\n📋 Test: ${testName}`);
        console.log(`Method: ${event.httpMethod} ${event.path}`);
        
        try {
            const response = await handler(event);
            console.log(`✅ Response Status: ${response.statusCode}`);
            
            if (response.body) {
                const body = JSON.parse(response.body);
                console.log('Response Body:', JSON.stringify(body, null, 2).substring(0, 200));
            }
            
            // Verify CORS headers
            if (!response.headers || !response.headers['Access-Control-Allow-Origin']) {
                console.warn('⚠️  Missing CORS headers');
            }
        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
        }
    }
    
    console.log('\n✨ Tests completed!');
}

// Run if executed directly
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { runTests };