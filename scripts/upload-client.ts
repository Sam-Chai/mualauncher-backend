import "dotenv/config";
import { open, stat, readFile } from "node:fs/promises";
import { clientSubmissionSchema, packageFormatVersionSchema, type UploadView } from "../src/lib/client-contract";

async function main() {
  const [fileName, metadataFile, clientId, instanceId] = process.argv.slice(2);
  const origin = process.env.MUA_API_URL; const token = process.env.MUA_API_TOKEN;
  if (!fileName || !metadataFile || !clientId || !origin || !token) throw new Error("Usage: MUA_API_URL=... MUA_API_TOKEN=... npm run client:upload -- client.zip metadata.json CLIENT_ID");
  const { packageFormatVersion, ...metadata } = clientSubmissionSchema.extend({ packageFormatVersion: packageFormatVersionSchema }).parse(JSON.parse(await readFile(metadataFile, "utf8")));
  const size = (await stat(fileName)).size;
  if (!/\.(zip|mrpack)$/i.test(fileName) || size <= 0 || size > 20 * 1024 ** 3) throw new Error("A complete ZIP or mrpack up to 20 GiB is required");
  const api = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(origin.replace(/\/$/, "") + path, { method: body === undefined ? "GET" : "POST",
      headers: { Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "API request failed"); return data;
  };
  const clients = await api<{ clientId: string; currentReleaseId: string | null; publicationRevision: number }[]>("/api/v1/clients");
  const current = clients.find(client => client.clientId === clientId); if (!current) throw new Error("Server is not accessible with this Token");
  const upload = await api<UploadView>("/api/v1/clients/uploads", { clientId, fileName: fileName.split(/[\\/]/).at(-1), size,
    packageFormatVersion,
    baseReleaseId: current.currentReleaseId, basePublicationRevision: current.publicationRevision });
  const file = await open(fileName, "r"); let completed = false;
  try {
    const parts: { partNumber: number; etag: string }[] = [];
    for (let offset = 0, partNumber = 1; offset < size; offset += upload.partSize, partNumber++) {
      const buffer = Buffer.alloc(Math.min(upload.partSize, size - offset)); let read = 0;
      while (read < buffer.length) { const result = await file.read(buffer, read, buffer.length - read, offset + read); if (!result.bytesRead) throw new Error("ZIP changed or was truncated during upload"); read += result.bytesRead; }
      let etag = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try { const signed = await api<{ url: string }>("/api/v1/clients/uploads/" + upload.id + "/parts", { partNumber });
          const response = await fetch(signed.url, { method: "PUT", body: new Uint8Array(buffer), signal: AbortSignal.timeout(300000) });
          if (!response.ok || !response.headers.get("etag")) throw new Error("S3 multipart upload failed"); etag = response.headers.get("etag")!; break;
        } catch (error) { if (attempt === 2) throw error; }
      }
      parts.push({ partNumber, etag }); console.log("Uploaded " + Math.min(100, Math.floor((offset + buffer.length) / size * 100)) + "%");
    }
    await api("/api/v1/clients/uploads/" + upload.id + "/complete", { parts }); completed = true;
    const deadline = Date.now() + 2 * 60 * 60 * 1000; let ready: UploadView;
    for (;;) {
      ready = await api<UploadView>("/api/v1/clients/uploads/" + upload.id);
      if (ready.status === "READY") break;
      if (ready.processingPhase === "SELECT_INSTANCE") {
        if (!instanceId) throw new Error(`Upload ${ready.id} contains multiple instances; select one in the panel or pass INSTANCE_ID as the fourth argument`);
        await api("/api/v1/clients/uploads/" + upload.id + "/select-instance", { instanceId });
      }
      if (ready.status === "FAILED" || ready.status === "CANCELLED") throw new Error(ready.error ?? "Upload processing failed");
      if (Date.now() > deadline) throw new Error("Worker wait timed out; the upload task remains available in the management panel");
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    const result = await api<{ draftId: string }>("/api/v1/clients/uploads/" + upload.id + "/submit", metadata);
    console.log(JSON.stringify({ clientId, uploadId: ready.id, draftId: result.draftId, status: "SUBMITTED", packageFormatVersion: ready.packageFormatVersion, statistics: ready.statistics, recipeStatistics: ready.recipeStatistics }));
  } finally {
    await file.close();
    if (!completed) { try { await api("/api/v1/clients/uploads/" + upload.id + "/cancel", {}); } catch { /* The user can cancel or retry the persisted task in the panel. */ } }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Client upload failed"); process.exitCode = 1; });
