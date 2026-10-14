import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

const clientId = z.string().uuid();

export function proxy(request: NextRequest) {
  // Reject invalid identities before the streaming admin layout commits its status.
  if (!clientId.safeParse(request.nextUrl.pathname.split("/").filter(Boolean)[2]).success) {
    return new NextResponse("Not Found", { status: 404 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/admin/clients/:id" };
