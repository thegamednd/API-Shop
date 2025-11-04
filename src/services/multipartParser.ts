import { APIGatewayProxyEvent } from 'aws-lambda';
import Busboy from 'busboy';

export interface ParsedFormData {
    fields: Record<string, string>;
    files: Array<{
        fieldName: string;
        filename: string;
        mimeType: string;
        data: Buffer;
    }>;
}

/**
 * Parse multipart/form-data from API Gateway event
 * @param event - API Gateway event
 * @returns Parsed form data with fields and files
 */
export function parseMultipartFormData(event: APIGatewayProxyEvent): Promise<ParsedFormData> {
    return new Promise((resolve, reject) => {
        const contentType = event.headers['Content-Type'] || event.headers['content-type'];

        if (!contentType || !contentType.includes('multipart/form-data')) {
            reject(new Error('Content-Type must be multipart/form-data'));
            return;
        }

        const result: ParsedFormData = {
            fields: {},
            files: []
        };

        try {
            const busboy = Busboy({
                headers: {
                    'content-type': contentType
                }
            });

            // Handle form fields
            busboy.on('field', (fieldName: string, value: string) => {
                console.log(`Field [${fieldName}]: ${value}`);
                result.fields[fieldName] = value;
            });

            // Handle file uploads
            busboy.on('file', (fieldName: string, fileStream: any, info: any) => {
                const { filename, mimeType } = info;
                console.log(`File [${fieldName}]: filename=${filename}, mimeType=${mimeType}`);

                const chunks: Buffer[] = [];

                fileStream.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                });

                fileStream.on('end', () => {
                    const fileData = Buffer.concat(chunks);
                    console.log(`File [${fieldName}] received: ${fileData.length} bytes`);
                    result.files.push({
                        fieldName,
                        filename,
                        mimeType,
                        data: fileData
                    });
                });

                fileStream.on('error', (error: Error) => {
                    console.error(`File stream error for ${fieldName}:`, error);
                    reject(error);
                });
            });

            // Handle completion
            busboy.on('finish', () => {
                console.log('Multipart parsing complete');
                resolve(result);
            });

            // Handle errors
            busboy.on('error', (error: Error) => {
                console.error('Busboy error:', error);
                reject(error);
            });

            // Decode and write the body to busboy
            // Handle API Gateway encoding - if base64 encoded, decode it; otherwise treat as latin1 (binary)
            let body: Buffer;
            if (event.isBase64Encoded) {
                body = Buffer.from(event.body || '', 'base64');
            } else {
                // For non-base64 encoded bodies, use latin1 encoding which preserves byte values
                body = Buffer.from(event.body || '', 'latin1');
            }

            console.log(`Body length: ${body.length} bytes, isBase64Encoded: ${event.isBase64Encoded}`);

            busboy.write(body);
            busboy.end();
        } catch (error) {
            console.error('Error parsing multipart data:', error);
            reject(error);
        }
    });
}
