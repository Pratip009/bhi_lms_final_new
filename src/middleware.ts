import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Coarse, fast gate on the edge. Every page and action re-checks against the database (see lib/auth.ts).
const PROTECTED: { prefix: string; roles: string[] }[] = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/instructor", roles: ["INSTRUCTOR"] },
  { prefix: "/enroll", roles: ["STUDENT"] },
  { prefix: "/application", roles: ["STUDENT"] },
  { prefix: "/dashboard", roles: ["STUDENT"] },
];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const rule = PROTECTED.find((r) => path === r.prefix || path.startsWith(r.prefix + "/"));
  if (!rule) return NextResponse.next();

  const token = req.cookies.get("bhi_session")?.value;
  let role: string | null = null;
  if (token && process.env.SESSION_SECRET) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET), { algorithms: ["HS256"] });
      role = typeof payload.role === "string" ? payload.role : null;
    } catch {
      role = null;
    }
  }
  if (!role) {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  if (!rule.roles.includes(role)) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/instructor/:path*", "/enroll/:path*", "/application/:path*", "/dashboard/:path*"],
};
