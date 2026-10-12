import { failure, json } from "@/lib/http";
import { publicDirectory } from "@/lib/public-database";
import { connection } from "next/server";

export async function GET() {
  await connection();
  try {
    return json({ servers: await publicDirectory() });
  } catch (error) { return failure(error); }
}
