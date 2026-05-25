import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "Use /api/skills for the authenticated user." },
    { status: 410 },
  );
}
