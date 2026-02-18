import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured" },
      { status: 503 }
    );
  }

  const { id: workflowId } = await params;
  const limitValue = Number(request.nextUrl.searchParams.get("limit") || "100");
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(500, limitValue)) : 100;

  try {
    const runs = await prisma.runHistory.findMany({
      where: { workflowId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      runs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load workflow runs",
      },
      { status: 500 }
    );
  }
}
