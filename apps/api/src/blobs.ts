/**
 * MinIO / S3-compatible object storage for OPAQUE blob ciphertext.
 *
 * The server stores and serves only ciphertext produced by crypto-core's
 * streaming AEAD on the client. It never decrypts, inspects, or derives keys for
 * blobs. Two upload paths exist:
 *   - `presignUpload`  : a presigned PUT URL the client uploads to directly.
 *   - `directUpload`   : a fallback where the client streams ciphertext through
 *                        the API (used when presigned URLs aren't reachable,
 *                        e.g. MinIO behind the same private network).
 */
import { Buffer } from 'node:buffer';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from './config.js';

export interface BlobStore {
  presignUpload(
    blobId: string,
    contentLength?: number,
  ): Promise<{ uploadUrl: string; expiresAt: Date }>;
  directUpload(blobId: string, body: Buffer, contentType?: string): Promise<void>;
  /** Fetch opaque ciphertext back (e.g. to render an encrypted signature image). */
  download(blobId: string): Promise<Buffer>;
  /**
   * Best-effort delete of a stored ciphertext object (used by crypto-shredding
   * to reclaim storage). Storage deletion is NOT what makes data unrecoverable
   * — stripping the sealed_keys already does — so this is reclamation only.
   */
  deleteObject(blobId: string): Promise<void>;
  ensureBucket(): Promise<void>;
  client: S3Client;
  bucket: string;
}

export function createBlobStore(config: AppConfig): BlobStore {
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
  });
  const bucket = config.S3_BUCKET;

  return {
    client,
    bucket,

    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    },

    async presignUpload(blobId, contentLength) {
      const cmd = new PutObjectCommand({
        Bucket: bucket,
        Key: blobId,
        // ciphertext is opaque application/octet-stream
        ContentType: 'application/octet-stream',
        ...(contentLength !== undefined ? { ContentLength: contentLength } : {}),
      });
      const uploadUrl = await getSignedUrl(client, cmd, {
        expiresIn: config.BLOB_TICKET_TTL_SECONDS,
      });
      const expiresAt = new Date(Date.now() + config.BLOB_TICKET_TTL_SECONDS * 1000);
      return { uploadUrl, expiresAt };
    },

    async directUpload(blobId, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: blobId,
          Body: body,
          ContentType: contentType ?? 'application/octet-stream',
        }),
      );
    },

    async download(blobId) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: blobId }));
      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) throw new Error('blob not found');
      return Buffer.from(await body.transformToByteArray());
    },

    async deleteObject(blobId) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: blobId }));
    },
  };
}

export { GetObjectCommand, DeleteObjectCommand };
