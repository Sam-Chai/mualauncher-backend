import type { Readable } from "node:stream";

export type StorageProvider = "minio" | "aws" | "s3" | "ali" | "tencent" | "huawei";
export type StorageConfiguration = {
  provider: StorageProvider; endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string;
  sessionToken?: string; forcePathStyle: boolean; customDomain: boolean;
};
export type BucketInput = { Bucket: string };
export type ObjectInput = BucketInput & { Key: string };
export type MultipartInput = ObjectInput & { UploadId: string };
export type ObjectHead = { ContentLength?: number; ContentType?: string; Metadata?: Record<string, string>; ETag?: string };
export type PutInput = ObjectInput & {
  Body: Buffer | Readable; ContentLength?: number; ContentType?: string; CacheControl?: string;
  Metadata?: Record<string, string>; ChecksumSHA256?: string; IfNoneMatch?: "*";
};
export type CreateMultipartInput = ObjectInput & Pick<PutInput, "ContentType" | "CacheControl" | "Metadata">;
export type CompleteInput = MultipartInput & { MultipartUpload: { Parts: { PartNumber: number; ETag: string }[] }; IfNoneMatch?: "*" };
export type CopyInput = ObjectInput & { CopySource: string; CopySourceIfMatch?: string };
export type PartCopyInput = MultipartInput & CopyInput & { PartNumber: number; CopySourceRange: string };
export type StorageOptions = { abortSignal?: AbortSignal };
export type SignOptions = { expiresIn: number; signingDate?: Date };

// Keep object metadata and opaque ETags unchanged across providers. Business code does not import vendor commands.
export interface ObjectStorage {
  readonly singleCopyLimitBytes: number;
  destroy(): void;
  headBucket(input: BucketInput): Promise<unknown>;
  createBucket(input: BucketInput): Promise<unknown>;
  deleteBucket(input: BucketInput): Promise<unknown>;
  headObject(input: ObjectInput): Promise<ObjectHead>;
  getObject(input: ObjectInput, options?: StorageOptions): Promise<ObjectHead & { Body?: Readable }>;
  putObject(input: PutInput, options?: StorageOptions): Promise<unknown>;
  deleteObject(input: ObjectInput): Promise<unknown>;
  deleteObjects(input: BucketInput & { Delete: { Objects: { Key: string }[] } }): Promise<unknown>;
  listObjects(input: BucketInput & { Prefix?: string; ContinuationToken?: string }): Promise<{
    Contents?: { Key?: string; Size?: number }[]; NextContinuationToken?: string; KeyCount?: number; IsTruncated?: boolean;
  }>;
  createMultipartUpload(input: CreateMultipartInput, options?: StorageOptions): Promise<{ UploadId?: string }>;
  uploadPart(input: MultipartInput & { PartNumber: number; Body: Buffer; ContentLength?: number }, options?: StorageOptions): Promise<{ ETag?: string }>;
  completeMultipartUpload(input: CompleteInput, options?: StorageOptions): Promise<unknown>;
  listParts(input: MultipartInput): Promise<{ IsTruncated?: boolean; Parts?: { PartNumber?: number; ETag?: string; Size?: number }[] }>;
  abortMultipartUpload(input: MultipartInput): Promise<unknown>;
  listMultipartUploads(input: BucketInput): Promise<{ Uploads?: { Key: string; UploadId: string }[] }>;
  copyObject(input: CopyInput): Promise<unknown>;
  uploadPartCopy(input: PartCopyInput): Promise<{ CopyPartResult?: { ETag?: string } }>;
  signUploadPart(input: MultipartInput & { PartNumber: number }, options: SignOptions): Promise<string>;
  signDownload(input: ObjectInput & { ResponseContentDisposition?: string }, options: SignOptions): Promise<string>;
}
