import { createHash, timingSafeEqual } from "node:crypto";

export function adminAuthError(request: Request): Response | null {
  const username = process.env.SPU_ADMIN_USER;
  const password = process.env.SPU_ADMIN_PASSWORD;
  const headers = { "Cache-Control": "private, no-store" };
  if (!username || !password) {
    return new Response("Admin access is not configured.", { status: 503, headers });
  }

  const supplied = request.headers.get("authorization") ?? "";
  const expected = "Basic " + Buffer.from(username + ":" + password, "utf8").toString("base64");
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (timingSafeEqual(digest(supplied), digest(expected))) return null;

  return new Response("Admin sign-in required.", {
    status: 401,
    headers: { ...headers, "WWW-Authenticate": 'Basic realm="SPU SKYE Admin", charset="UTF-8"' },
  });
}
