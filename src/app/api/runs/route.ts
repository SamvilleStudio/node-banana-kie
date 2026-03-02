import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured" },
      { status: 503 }
    );
  }

  const projectId = request.nextUrl.searchParams.get("projectId");
  const workflowId = request.nextUrl.searchParams.get("workflowId");
  const limitValue = Number(request.nextUrl.searchParams.get("limit") || "50");
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(200, limitValue)) : 50;

  try {
    const runs = await prisma.runHistory.findMany({
      where: {
        projectId: projectId || undefined,
        workflowId: workflowId || undefined,
      },
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
        error: error instanceof Error ? error.message : "Failed to load run history",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const logsJson = (body.logs ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim().length > 0
        ? body.sessionId.trim()
        : `run-${Date.now()}`;

    const run = await prisma.runHistory.upsert({
      where: { sessionId },
      create: {
        sessionId,
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        workflowId: typeof body.workflowId === "string" ? body.workflowId : null,
        startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
        endedAt: body.endedAt ? new Date(body.endedAt) : null,
        status: typeof body.status === "string" ? body.status : "running",
        nodeCount: typeof body.nodeCount === "number" ? body.nodeCount : null,
        cost: typeof body.cost === "number" ? body.cost : null,
        error: typeof body.error === "string" ? body.error : null,
        logs: logsJson,
      },
      update: {
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        workflowId: typeof body.workflowId === "string" ? body.workflowId : null,
        startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
        endedAt: body.endedAt ? new Date(body.endedAt) : null,
        status: typeof body.status === "string" ? body.status : "running",
        nodeCount: typeof body.nodeCount === "number" ? body.nodeCount : null,
        cost: typeof body.cost === "number" ? body.cost : null,
        error: typeof body.error === "string" ? body.error : null,
        logs: logsJson,
      },
    });

    return NextResponse.json({
      success: true,
      run,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save run entry",
      },
      { status: 500 }
    );
  }
}
