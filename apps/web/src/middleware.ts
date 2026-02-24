import { NextRequest, NextResponse } from "next/server";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const PENDING_COOKIE = "karibu_pending_token";
const SUBDOMAIN_COOKIE = "karibu_subdomain";

function extractSubdomain(host: string): string | null {
  // Extract first part before the dot (same logic as backend)
  // demo.localhost:3000 → "demo"
  // acme.karibu.ai → "acme"
  const subdomain = host.split(".")[0];
  return subdomain || null;
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Extract and set subdomain cookie
  const host = request.headers.get("host");
  if (host) {
    const subdomain = extractSubdomain(host);
    if (subdomain) {
      response.cookies.set(SUBDOMAIN_COOKIE, subdomain, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    }
  }

  const token = request.nextUrl.searchParams.get("token");

  if (!token) return response;

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      return NextResponse.redirect(
        new URL("/error-page?key=invalid_token", request.url)
      );
    }

    const data = await res.json();

    const redirectResponse = NextResponse.redirect(new URL("/", request.url));
    redirectResponse.cookies.set(PENDING_COOKIE, JSON.stringify(data), {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60,
    });

    return redirectResponse;
  } catch {
    return NextResponse.redirect(
      new URL("/error-page?key=server_error", request.url)
    );
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
