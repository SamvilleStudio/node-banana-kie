import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { Prisma } from "@prisma/client";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getProjectGenerationsPublicPath } from "@/lib/storagePaths";
import { logger } from "@/utils/logger";

export const maxDuration = 300; // 5 minute timeout for large workflow files

interface WorkflowPayload {
  id?: string;
  name?: string;
  version?: number;
  nodes?: unknown[];
  edges?: unknown[];
  edgeStyle?: string;
  groups?: Record<string, unknown>;
}

interface SaveWorkflowBody {
  directoryPath?: string;
  filename?: string;
  projectId?: string;
  workflow?: WorkflowPayload;
}

function normalizePathForFsAndResponse(value: string): string {
  return value.replace(/\\/g, "/");
}

async function saveWorkflowToDatabase({
  workflow,
  filename,
  projectId,
}: {
  workflow: WorkflowPayload;
  filename?: string;
  projectId?: string;
}): Promise<{ projectId: string; workflowId: string; generationsPath: string }> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured");
  }

  const workflowName = (workflow.name || filename || "workflow").trim();
  const workflowId = (workflow.id || "").trim() || `wf_${Date.now()}`;
  const workflowJson = workflow as unknown as Prisma.InputJsonValue;

  const existingProject =
    projectId && projectId.trim()
      ? await prisma.project.findUnique({ where: { id: projectId.trim() } })
      : null;

  const resolvedProject =
    existingProject ||
    (await prisma.project.create({
      data: {
        id: projectId && projectId.trim() ? projectId.trim() : undefined,
        name: workflowName,
      },
    }));

  await prisma.workflow.upsert({
    where: { id: workflowId },
    create: {
      id: workflowId,
      projectId: resolvedProject.id,
      name: workflowName,
      version: typeof workflow.version === "number" ? workflow.version : 1,
      data: workflowJson,
    },
    update: {
      projectId: resolvedProject.id,
      name: workflowName,
      version: typeof workflow.version === "number" ? workflow.version : 1,
      data: workflowJson,
    },
  });

  return {
    projectId: resolvedProject.id,
    workflowId,
    generationsPath: getProjectGenerationsPublicPath(resolvedProject.id),
  };
}

// POST: Save workflow to file
export async function POST(request: NextRequest) {
  let directoryPath: string | undefined;
  let filename: string | undefined;
  let projectId: string | undefined;
  try {
    const body = (await request.json()) as SaveWorkflowBody;
    directoryPath = body.directoryPath;
    filename = body.filename;
    projectId = body.projectId;
    const workflow = body.workflow;

    logger.info('file.save', 'Workflow save request received', {
      directoryPath,
      filename,
      projectId,
      hasWorkflow: !!workflow,
      nodeCount: workflow?.nodes?.length,
      edgeCount: workflow?.edges?.length,
    });

    if (!workflow) {
      logger.warn('file.save', 'Workflow save validation failed: missing fields', {
        hasWorkflow: !!workflow,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!projectId && !directoryPath) {
      logger.warn('file.save', 'Workflow save validation failed: missing fields', {
        hasDirectoryPath: !!directoryPath,
        hasProjectId: !!projectId,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (projectId) {
      try {
        const dbResult = await saveWorkflowToDatabase({
          workflow,
          filename,
          projectId,
        });

        logger.info('file.save', 'Workflow saved to database', {
          workflowId: dbResult.workflowId,
          projectId: dbResult.projectId,
        });

        return NextResponse.json({
          success: true,
          mode: "database",
          workflowId: dbResult.workflowId,
          projectId: dbResult.projectId,
          generationsPath: dbResult.generationsPath,
        });
      } catch (dbError) {
        logger.error(
          "file.error",
          "Failed to save workflow to database",
          { projectId, filename },
          dbError instanceof Error ? dbError : undefined
        );

        return NextResponse.json(
          {
            success: false,
            error:
              dbError instanceof Error
                ? dbError.message
                : "Failed to save workflow to database",
          },
          { status: 500 }
        );
      }
    }

    if (!directoryPath || !filename) {
      logger.warn('file.save', 'Workflow save validation failed: missing fields', {
        hasDirectoryPath: !!directoryPath,
        hasFilename: !!filename,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate directory exists
    try {
      const stats = await fs.stat(directoryPath);
      if (!stats.isDirectory()) {
        logger.warn('file.error', 'Workflow save failed: path is not a directory', {
          directoryPath,
        });
        return NextResponse.json(
          { success: false, error: "Path is not a directory" },
          { status: 400 }
        );
      }
    } catch (dirError) {
      logger.warn('file.error', 'Workflow save failed: directory does not exist', {
        directoryPath,
      });
      return NextResponse.json(
        { success: false, error: "Directory does not exist" },
        { status: 400 }
      );
    }

    // Auto-create subfolders for inputs and generations
    const inputsFolder = normalizePathForFsAndResponse(path.join(directoryPath, "inputs"));
    const generationsFolder = normalizePathForFsAndResponse(path.join(directoryPath, "generations"));

    try {
      await fs.mkdir(inputsFolder, { recursive: true });
      await fs.mkdir(generationsFolder, { recursive: true });
    } catch (mkdirError) {
      logger.warn('file.save', 'Failed to create subfolders (non-fatal)', {
        inputsFolder,
        generationsFolder,
        error: mkdirError instanceof Error ? mkdirError.message : 'Unknown error',
      });
      // Continue anyway - folders may already exist or be created later
    }

    // Sanitize filename (remove special chars, ensure .json extension)
    const safeName = filename.replace(/[^a-zA-Z0-9-_]/g, "_");
    const filePath = normalizePathForFsAndResponse(path.join(directoryPath, `${safeName}.json`));

    // Write workflow JSON
    const json = JSON.stringify(workflow, null, 2);
    await fs.writeFile(filePath, json, "utf-8");

    logger.info('file.save', 'Workflow saved successfully', {
      filePath,
      fileSize: json.length,
    });

    return NextResponse.json({
      success: true,
      filePath,
      mode: "filesystem",
    });
  } catch (error) {
    logger.error('file.error', 'Failed to save workflow', {
      directoryPath,
      filename,
      projectId,
    }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Save failed",
      },
      { status: 500 }
    );
  }
}

// GET: Validate directory path (legacy) or fetch workflow by ID (database mode)
export async function GET(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get("id");
  const directoryPath = request.nextUrl.searchParams.get("path");

  if (workflowId) {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { success: false, error: "DATABASE_URL is not configured" },
        { status: 503 }
      );
    }

    try {
      const workflow = await prisma.workflow.findUnique({
        where: { id: workflowId },
      });

      if (!workflow) {
        return NextResponse.json(
          { success: false, error: "Workflow not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        mode: "database",
        workflow: workflow.data,
        workflowId: workflow.id,
        projectId: workflow.projectId,
        name: workflow.name,
      });
    } catch (error) {
      logger.error(
        "file.error",
        "Failed to load workflow from database",
        { workflowId },
        error instanceof Error ? error : undefined
      );
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Load failed",
        },
        { status: 500 }
      );
    }
  }

  logger.info('file.load', 'Directory validation request received', {
    directoryPath,
  });

  if (!directoryPath) {
    logger.warn('file.load', 'Directory validation failed: missing path parameter');
    return NextResponse.json(
      { success: false, error: "Path parameter required" },
      { status: 400 }
    );
  }

  try {
    const stats = await fs.stat(directoryPath);
    const isDirectory = stats.isDirectory();
    logger.info('file.load', 'Directory validation successful', {
      directoryPath,
      exists: true,
      isDirectory,
    });
    return NextResponse.json({
      success: true,
      exists: true,
      isDirectory,
    });
  } catch (error) {
    logger.info('file.load', 'Directory does not exist', {
      directoryPath,
    });
    return NextResponse.json({
      success: true,
      exists: false,
      isDirectory: false,
    });
  }
}
