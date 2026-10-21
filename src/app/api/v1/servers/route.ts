import { failure, json } from "@/lib/http";
import { memberState } from "@/lib/member-access";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  try {
    return json({ servers: (await memberState(request)).servers });
  } catch (error) { return failure(error); }
}
