import { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Parse JWT token payload without verification (since we trust API Gateway)
 */
function parseJWTPayload(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT token format');
    }

    const payload = parts[1];
    // Add padding if needed for base64 decoding
    const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = Buffer.from(paddedPayload, 'base64').toString();
    return JSON.parse(decoded);
  } catch (error) {
    throw new Error(`Failed to parse JWT payload: ${error}`);
  }
}

/**
 * Result object returned by authentication and authorization checks
 */
export interface AuthenticationResult {
  /** HTTP status code (200 for success, 401/403/500 for various failures) */
  statusCode: number;
  /** The user's unique identifier from Cognito (sub claim) */
  userID?: string;
  /** Whether the user has admin privileges */
  isAdmin?: boolean;
  /** Error message when authentication/authorization fails */
  message?: string;
}

/**
 * Check authentication for a user request
 *
 * Validates the user's JWT token from Cognito and checks admin status
 */
export async function checkAuthentication(event: APIGatewayProxyEvent): Promise<AuthenticationResult> {
  try {
    // Check for Authorization header
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        message: 'Unauthorized - no authorization header'
      };
    }

    // Extract and parse the JWT
    const token = authHeader.replace('Bearer ', '');
    const payload = parseJWTPayload(token);

    // Extract user ID (sub claim)
    const userID = payload.sub;
    if (!userID) {
      return {
        statusCode: 401,
        message: 'Unauthorized - no user context'
      };
    }

    // Check if user is in Administrators group
    const groups = payload['cognito:groups'] || [];
    const isAdmin = groups.includes('Administrators');

    return {
      statusCode: 200,
      userID,
      isAdmin
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return {
      statusCode: 500,
      message: 'Internal server error during authentication'
    };
  }
}
