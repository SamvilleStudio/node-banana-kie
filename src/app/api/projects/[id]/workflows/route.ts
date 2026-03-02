import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Params) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured" },
      { status: 503 }
    );
  }

  const { id: projectId } = await params;
  try {
    const workflows = await prisma.workflow.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      workflows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list workflows",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { success: false, error: "DATABASE_URL is not configured" },
      { status: 503 }
    );
  }

  const { id: projectId } = await params;
  try {
    const body = await request.json();
    const workflow = body.workflow;
    const workflowJson = workflow as Prisma.InputJsonValue;
    const id =
      typeof body.id === "string" && body.id.trim().length > 0
        ? body.id.trim()
        : `wf_${Date.now()}`;
    const name =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : "workflow";

    if (!workflow) {
      return NextResponse.json(
        { success: false, error: "workflow payload is required" },
        { status: 400 }
      );
    }

    const saved = await prisma.workflow.upsert({
      where: { id },
      create: {
        id,
        projectId,
        name,
        version: typeof body.version === "number" ? body.version : 1,
        data: workflowJson,
      },
      update: {
        projectId,
        name,
        version: typeof body.version === "number" ? body.version : 1,
        data: workflowJson,
      },
    });

    return NextResponse.json({
      success: true,
      workflow: saved,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save workflow",
      },
      { status: 500 }
    );
  }
}
