import { S3Client, HeadBucketCommand, CreateBucketCommand, DeleteBucketCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand,
  DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  ListPartsCommand, AbortMultipartUploadCommand, ListMultipartUploadsCommand, CopyObjectCommand, UploadPartCopyCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import type { BucketLocationConstraint } from "@aws-sdk/client-s3";
import type { ObjectStorage, StorageConfiguration } from "./types";

export function createS3Storage(configuration: StorageConfiguration): ObjectStorage {
  const client = new S3Client({ endpoint: configuration.endpoint, region: configuration.region, forcePathStyle: configuration.forcePathStyle,
    credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey, sessionToken: configuration.sessionToken },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 3 });
  return {
    singleCopyLimitBytes: 5 * 1024 ** 3,
    destroy: () => client.destroy(),
    headBucket: input => client.send(new HeadBucketCommand(input)),
    createBucket: input => client.send(new CreateBucketCommand({ ...input, ...(configuration.provider === "aws" && configuration.region !== "us-east-1"
      ? { CreateBucketConfiguration: { LocationConstraint: configuration.region as BucketLocationConstraint } } : {}) })),
    deleteBucket: input => client.send(new DeleteBucketCommand(input)),
    headObject: input => client.send(new HeadObjectCommand(input)),
    getObject: async (input, options) => { const result = await client.send(new GetObjectCommand(input), options); return { ...result, Body: result.Body as Readable | undefined }; },
    putObject: (input, options) => client.send(new PutObjectCommand(input), options),
    deleteObject: input => client.send(new DeleteObjectCommand(input)),
    deleteObjects: input => client.send(new DeleteObjectsCommand(input)),
    listObjects: input => client.send(new ListObjectsV2Command(input)),
    createMultipartUpload: (input, options) => client.send(new CreateMultipartUploadCommand(input), options),
    uploadPart: (input, options) => client.send(new UploadPartCommand(input), options),
    completeMultipartUpload: (input, options) => client.send(new CompleteMultipartUploadCommand(input), options),
    listParts: input => client.send(new ListPartsCommand(input)),
    abortMultipartUpload: input => client.send(new AbortMultipartUploadCommand(input)),
    listMultipartUploads: async input => { const result = await client.send(new ListMultipartUploadsCommand(input)); return { Uploads: result.Uploads?.flatMap(row => row.Key && row.UploadId ? [{ Key: row.Key, UploadId: row.UploadId }] : []) }; },
    copyObject: input => client.send(new CopyObjectCommand(input)),
    uploadPartCopy: input => client.send(new UploadPartCopyCommand(input)),
    signUploadPart: (input, options) => getSignedUrl(client, new UploadPartCommand(input), options),
    signDownload: (input, options) => getSignedUrl(client, new GetObjectCommand(input), options),
  };
}
