import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const TARGET_WIDTH = 300;
const TARGET_HEIGHT = 500;
const MAX_FILE_SIZE = 50 * 1024; // 50kb in bytes

/**
 * Process and resize image to meet requirements
 * @param imageBuffer - Raw image buffer
 * @returns Processed image buffer
 */
export async function processImage(imageBuffer: Buffer): Promise<Buffer> {
    try {
        console.log(`Processing image: Input size ${imageBuffer.length} bytes`);

        // Resize image to exact dimensions (cover mode will crop if necessary)
        let processedBuffer = await sharp(imageBuffer)
            .resize(TARGET_WIDTH, TARGET_HEIGHT, {
                fit: 'cover',
                position: 'center',
                background: { r: 255, g: 255, b: 255, alpha: 1 } // White background
            })
            .jpeg({ quality: 90 })
            .toBuffer();

        console.log(`Initial processed size: ${processedBuffer.length} bytes`);

        // If still too large, reduce quality iteratively
        let quality = 85;
        while (processedBuffer.length > MAX_FILE_SIZE && quality > 10) {
            console.log(`Reducing quality to ${quality}%`);
            processedBuffer = await sharp(imageBuffer)
                .resize(TARGET_WIDTH, TARGET_HEIGHT, {
                    fit: 'cover',
                    position: 'center',
                    background: { r: 255, g: 255, b: 255, alpha: 1 }
                })
                .jpeg({ quality })
                .toBuffer();

            quality -= 10;
        }

        console.log(`Final processed size: ${processedBuffer.length} bytes`);

        if (processedBuffer.length > MAX_FILE_SIZE) {
            console.warn(`Could not compress image below ${MAX_FILE_SIZE} bytes. Final size: ${processedBuffer.length} bytes`);
        }

        return processedBuffer;
    } catch (error) {
        console.error('Error processing image:', error);
        throw new Error(`Failed to process image: ${error.message}`);
    }
}

/**
 * Upload image to S3
 * @param imageBuffer - Processed image buffer
 * @param gamingSystemId - Gaming system ID
 * @param shopId - Shop product ID
 * @param environment - 'dev' or 'prod'
 * @returns The S3 path (not full URL, just the key)
 */
export async function uploadImageToS3(
    imageBuffer: Buffer,
    gamingSystemId: string,
    shopId: string,
    environment: 'dev' | 'prod' = 'dev'
): Promise<string> {
    try {
        const bucket = environment === 'prod' ? 'realmforge-shop-media' : 'dev-realmforge-shop-media';
        const key = `${gamingSystemId}/${shopId}/product.jpg`;

        console.log(`Uploading image to S3: ${bucket}/${key}`);

        const s3Client = new S3Client({ region: process.env.AWS_REGION || 'eu-west-2' });

        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: imageBuffer,
            ContentType: 'image/jpeg',
            CacheControl: 'public, max-age=31536000', // Cache for 1 year
            ACL: 'public-read' // Make publicly readable
        });

        await s3Client.send(command);

        console.log(`Image uploaded successfully: ${key}`);

        // Return just the path, not the full URL
        return key;
    } catch (error) {
        console.error('Error uploading to S3:', error);
        throw new Error(`Failed to upload image to S3: ${error.message}`);
    }
}

/**
 * Main function to process and upload product image
 * @param imageBuffer - Raw image buffer
 * @param gamingSystemId - Gaming system ID
 * @param shopId - Shop product ID
 * @param environment - 'dev' or 'prod'
 * @returns The S3 key/path
 */
export async function uploadProductImage(
    imageBuffer: Buffer,
    gamingSystemId: string,
    shopId: string,
    environment: 'dev' | 'prod' = 'dev'
): Promise<string> {
    try {
        if (!imageBuffer || imageBuffer.length === 0) {
            throw new Error('No image data provided');
        }

        if (!gamingSystemId || !shopId) {
            throw new Error('Gaming System ID and Shop ID are required');
        }

        console.log(`Processing product image for ${gamingSystemId}/${shopId}`);

        // Process image (resize and compress)
        const processedBuffer = await processImage(imageBuffer);

        // Upload to S3
        const imagePath = await uploadImageToS3(processedBuffer, gamingSystemId, shopId, environment);

        return imagePath;
    } catch (error) {
        console.error('Error in uploadProductImage:', error);
        throw error;
    }
}
