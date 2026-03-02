import { NextRequest, NextResponse } from "next/server";
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
  const limitValue = Number(request.nextUrl.searchParams.get("limit") || "100");
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(500, limitValue)) : 100;

  try {
    const images = await prisma.generatedAsset.findMany({
      where: {
        projectId: projectId || undefined,
        workflowId: workflowId || undefined,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      images,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load image metadata",
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
    const storageId =
      typeof body.storageId === "string" && body.storageId.trim().length > 0
        ? body.storageId.trim()
        : null;

    if (!storageId) {
      return NextResponse.json(
        { success: false, error: "storageId is required" },
        { status: 400 }
      );
    }

    const image = await prisma.generatedAsset.upsert({
      where: { storageId },
      create: {
        storageId,
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        workflowId: typeof body.workflowId === "string" ? body.workflowId : null,
        type: typeof body.type === "string" ? body.type : "image",
        mimeType: typeof body.mimeType === "string" ? body.mimeType : "image/png",
        fileName: typeof body.fileName === "string" ? body.fileName : `${storageId}.png`,
        filePath: typeof body.filePath === "string" ? body.filePath : "",
        fileHash: typeof body.fileHash === "string" ? body.fileHash : "",
        nodeId: typeof body.nodeId === "string" ? body.nodeId : null,
        prompt: typeof body.prompt === "string" ? body.prompt : null,
        modelId: typeof body.modelId === "string" ? body.modelId : null,
        cost: typeof body.cost === "number" ? body.cost : null,
      },
      update: {
        projectId: typeof body.projectId === "string" ? body.projectId : null,
        workflowId: typeof body.workflowId === "string" ? body.workflowId : null,
        type: typeof body.type === "string" ? body.type : "image",
        mimeType: typeof body.mimeType === "string" ? body.mimeType : "image/png",
        fileName: typeof body.fileName === "string" ? body.fileName : `${storageId}.png`,
        filePath: typeof body.filePath === "string" ? body.filePath : "",
        fileHash: typeof body.fileHash === "string" ? body.fileHash : "",
        nodeId: typeof body.nodeId === "string" ? body.nodeId : null,
        prompt: typeof body.prompt === "string" ? body.prompt : null,
        modelId: typeof body.modelId === "string" ? body.modelId : null,
        cost: typeof body.cost === "number" ? body.cost : null,
      },
    });

    return NextResponse.json({
      success: true,
      image,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to save image metadata",
      },
      { status: 500 }
    );
  }
}
