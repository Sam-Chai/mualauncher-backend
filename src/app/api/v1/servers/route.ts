import { failure, json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { publishedServers } from "@/lib/catalog";
import { connection } from "next/server";

export async function GET() {
  await connection();
  try {
    return json({ servers: await publishedServers(prisma) });
  } catch (error) { return failure(error); }
}
