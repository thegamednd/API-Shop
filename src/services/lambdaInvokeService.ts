import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'eu-west-2' });
const FUNCTION_NAME = process.env.SHOP_UPDATE_FUNCTION_NAME || 'Task-ShopProductUpdate';

/**
 * Payload for the shop product update propagation task
 */
export interface ShopProductUpdateMessage {
  productId: string;
  gamingSystemId: string;
}

/**
 * Invoke the Task-ShopProductUpdate Lambda asynchronously.
 * Uses InvocationType 'Event' to return 202 immediately (fire-and-forget).
 */
export async function invokeShopProductUpdate(message: ShopProductUpdateMessage): Promise<void> {
  try {
    const command = new InvokeCommand({
      FunctionName: FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: JSON.stringify(message),
    });

    await lambdaClient.send(command);

    console.log(`Invoked ${FUNCTION_NAME} async for product ${message.productId}`);
  } catch (error) {
    console.error('Error invoking shop product update Lambda:', error);
    throw new Error(`Failed to invoke shop product update: ${(error as Error).message}`);
  }
}
