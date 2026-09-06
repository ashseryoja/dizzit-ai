import { NextResponse } from "next/server"

import { clearSessionCookie } from "@/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return new NextResponse(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie(request) } })
}
