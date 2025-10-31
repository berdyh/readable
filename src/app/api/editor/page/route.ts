import { NextRequest, NextResponse } from "next/server";

function generatePageId(): string {
  return `page_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a new page/workspace
 * POST /api/editor/page
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { title, userId } = body as { title?: string; userId?: string };

    // Create a new page ID
    const pageId = generatePageId();

    // In a real app, this would create a new page in the database
    // For now, we'll just return a page object
    const page = {
      id: pageId,
      title: title || "New Page",
      userId: userId || "default",
      createdAt: new Date().toISOString(),
      content: [],
    };

    return NextResponse.json({ page }, { status: 200 });
  } catch (error) {
    console.error("[editor/page] Failed to create page", error);
    const message =
      error instanceof Error ? error.message : "Failed to create page.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Get page information
 * GET /api/editor/page?id={pageId}
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pageId = searchParams.get("id");

    if (!pageId) {
      return NextResponse.json(
        { error: "pageId is required" },
        { status: 400 },
      );
    }

    // In a real app, this would fetch from database
    // For now, return a placeholder
    const page = {
      id: pageId,
      title: "Page",
      content: [],
    };

    return NextResponse.json({ page }, { status: 200 });
  } catch (error) {
    console.error("[editor/page] Failed to get page", error);
    const message =
      error instanceof Error ? error.message : "Failed to get page.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

