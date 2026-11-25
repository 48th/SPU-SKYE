import { NextResponse } from "next/server";
import { adminAuthError } from "@/lib/adminAuth";

export function proxy(request: Request) {
  const error = adminAuthError(request);
  if (error) return error;

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: "/admin/:path*" };
