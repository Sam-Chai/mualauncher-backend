import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverId } from "@/lib/input";
import { publicFile } from "@/lib/client-download";
import { json, failure } from "@/lib/http";
export async function GET(_request: Request, context: { params: Promise<{ serverId: string; sha256: string }> }) {
  await connection();
  try { const params = await context.params; return json(await publicFile(prisma, serverId(params.serverId), params.sha256)); }
  catch (error) { return failure(error); }
}
