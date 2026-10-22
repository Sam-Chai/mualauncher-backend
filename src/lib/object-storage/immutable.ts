import { diagnosticText } from "@/lib/diagnostics";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { invariant } from "../errors";
import type { ObjectStorage } from "./types";

// Native services may silently ignore a new header in an older region. Probe disposable objects,
// and fail closed before touching CAS/manifests/packages if atomic no-overwrite is unavailable.
export function guardImmutableStorage(adapter: ObjectStorage): ObjectStorage {
  const verified = new Map<string, Promise<void>>();
  const probe = async (Bucket: string) => {
    const Key = `.union-link-storage-probes/${randomUUID()}`;
    let uploadId: string | undefined;
    const expectConflict = async (operation: () => Promise<unknown>) => {
      let blocked = false;
      try { await operation(); } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 412) blocked = true;
        else throw error;
      }
      invariant(blocked, 503, diagnosticText("diagnostics.immutable.objectStorageCannotAtomicallyPreventOverwritesImmutableWritesAreBlocked"));
    };
    try {
      await adapter.putObject({ Bucket, Key, Body: Buffer.from("original") });
      await expectConflict(() => adapter.putObject({ Bucket, Key, Body: Buffer.from("replacement"), IfNoneMatch: "*" }));
      uploadId = (await adapter.createMultipartUpload({ Bucket, Key })).UploadId;
      invariant(uploadId, 503, diagnosticText("diagnostics.immutable.objectStorageCapabilityVerificationCouldNotInitializeAMultipartUpload"));
      const identity = { Bucket, Key, UploadId: uploadId };
      const part = await adapter.uploadPart({ ...identity, PartNumber: 1, Body: Buffer.from("replacement") });
      invariant(part.ETag, 503, diagnosticText("diagnostics.immutable.objectStorageCapabilityVerificationReturnedNoPartEtag"));
      await expectConflict(() => adapter.completeMultipartUpload({ ...identity, MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag! }] }, IfNoneMatch: "*" }));
    } finally {
      if (uploadId) await adapter.abortMultipartUpload({ Bucket, Key, UploadId: uploadId }).catch(() => {});
      await adapter.deleteObject({ Bucket, Key });
    }
  };
  const ensure = (Bucket: string) => {
    let pending = verified.get(Bucket);
    if (!pending) { pending = probe(Bucket); verified.set(Bucket, pending); pending.catch(() => verified.delete(Bucket)); }
    return pending;
  };
  return { ...adapter,
    putObject: async (input, options) => {
      try { options?.abortSignal?.throwIfAborted(); if (input.IfNoneMatch) await ensure(input.Bucket); return await adapter.putObject(input, options); }
      catch (error) { if (input.Body instanceof Readable) input.Body.destroy(); throw error; }
    },
    completeMultipartUpload: async (input, options) => { options?.abortSignal?.throwIfAborted(); if (input.IfNoneMatch) await ensure(input.Bucket); return adapter.completeMultipartUpload(input, options); },
  };
}
