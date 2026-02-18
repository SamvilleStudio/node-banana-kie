import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import {
  getProjectGenerationsFsPath,
  resolveStorageDirectoryPath,
  toPublicUploadsPath,
} from "@/lib/storagePaths";
import { logger } from "@/utils/logger";

// Helper to get file extension from MIME type
function getExtensionFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };

  // Check explicit mapping first
  if (mimeToExt[mimeType]) {
    return mimeToExt[mimeType];
  }

  // Fallback based on MIME type prefix
  if (mimeType.startsWith("image/")) {
    return "png";
  }
  if (mimeType.startsWith("video/")) {
    return "mp4";
  }

  // Unknown type - use generic binary extension
  return "bin";
}

function isUploadsUrlPath(inputPath: string): boolean {
  return inputPath.trim().replace(/\\/g, "/").startsWith("/uploads/");
}

function normalizePathForResponse(value: string): string {
  return value.replace(/\\/g, "/");
}

// Helper to detect if a string is an HTTP URL
function isHttpUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

// Helper to compute MD5 hash of buffer content
function computeContentHash(buffer: Buffer): string {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

// Helper to find existing file by hash suffix
async function findExistingFileByHash(
  directoryPath: string,
  hash: string,
  extension: string
): Promise<string | null> {
  try {
    const files = await fs.readdir(directoryPath);
    // Look for files ending with this hash before extension
    const hashSuffix = `_${hash}.${extension}`;
    const matching = files.find((f) => f.endsWith(hashSuffix));
    return matching || null;
  } catch {
    return null;
  }
}

async function ensureProjectAndWorkflowRefs(projectId?: string, workflowId?: string) {
  if (!isDatabaseConfigured() || !projectId) {
    return { projectId: null as string | null, workflowId: null as string | null };
  }

  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) {
    return { projectId: null as string | null, workflowId: null as string | null };
  }

  const project =
    (await prisma.project.findUnique({ where: { id: normalizedProjectId } })) ??
    (await prisma.project.create({
      data: {
        id: normalizedProjectId,
        name: "Untitled Project",
      },
    }));

  if (!workflowId) {
    return { projectId: project.id, workflowId: null as string | null };
  }

  const normalizedWorkflowId = workflowId.trim();
  if (!normalizedWorkflowId) {
    return { projectId: project.id, workflowId: null as string | null };
  }

  const workflow = await prisma.workflow.findUnique({
    where: { id: normalizedWorkflowId },
  });

  return {
    projectId: project.id,
    workflowId: workflow ? workflow.id : null,
  };
}

// POST: Save a generated image or video to the generations folder (or outputs folder)
export async function POST(request: NextRequest) {
  let directoryPath: string | undefined;
  let resolvedDirectoryPath: string | undefined;
  let projectId: string | undefined;
  let workflowId: string | undefined;
  try {
    const body = await request.json();
    directoryPath = body.directoryPath;
    projectId = body.projectId;
    workflowId = body.workflowId;
    const nodeId = body.nodeId;
    const image = body.image;
    const video = body.video;
    const prompt = body.prompt;
    const modelId = body.modelId;
    const cost = typeof body.cost === "number" ? body.cost : null;
    const imageId = body.imageId; // Optional ID for carousel support
    const customFilename = body.customFilename; // Optional custom filename (without extension)
    const createDirectory = body.createDirectory; // Optional flag to create directory if it doesn't exist

    const isVideo = !!video;
    const content = video || image;

    if (!directoryPath && projectId) {
      resolvedDirectoryPath = getProjectGenerationsFsPath(projectId);
    } else if (directoryPath) {
      resolvedDirectoryPath = resolveStorageDirectoryPath(directoryPath);
    }

    logger.info('file.save', 'Generation auto-save request received', {
      directoryPath,
      resolvedDirectoryPath,
      projectId,
      workflowId,
      hasImage: !!image,
      hasVideo: !!video,
      prompt,
      customFilename,
    });

    if (!resolvedDirectoryPath || !content) {
      logger.warn('file.save', 'Generation save validation failed: missing fields', {
        hasDirectoryPath: !!resolvedDirectoryPath,
        hasContent: !!content,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate directory exists (or create if requested)
    try {
      const stats = await fs.stat(resolvedDirectoryPath);
      if (!stats.isDirectory()) {
        logger.warn('file.error', 'Generation save failed: path is not a directory', {
          directoryPath: resolvedDirectoryPath,
        });
        return NextResponse.json(
          { success: false, error: "Path is not a directory" },
          { status: 400 }
        );
      }
    } catch (dirError) {
      // Directory doesn't exist - create it if requested
      if (createDirectory || !!projectId || (directoryPath ? isUploadsUrlPath(directoryPath) : false)) {
        try {
          await fs.mkdir(resolvedDirectoryPath, { recursive: true });
          logger.info('file.save', 'Created output directory', { directoryPath: resolvedDirectoryPath });
        } catch (mkdirError) {
          logger.error('file.error', 'Failed to create output directory', {
            directoryPath: resolvedDirectoryPath,
          }, mkdirError instanceof Error ? mkdirError : undefined);
          return NextResponse.json(
            { success: false, error: "Failed to create output directory" },
            { status: 500 }
          );
        }
      } else {
        logger.warn('file.error', 'Generation save failed: directory does not exist', {
          directoryPath: resolvedDirectoryPath,
        });
        return NextResponse.json(
          { success: false, error: "Directory does not exist" },
          { status: 400 }
        );
      }
    }

    let buffer: Buffer;
    let extension: string;
    let mimeType = isVideo ? "video/mp4" : "image/png";

    if (isHttpUrl(content)) {
      // Handle HTTP URL (common for large video files from providers)
      logger.info('file.save', 'Fetching content from URL', { url: content.substring(0, 100) });

      // Set up timeout to prevent hanging requests (60 seconds for large video files)
      const FETCH_TIMEOUT_MS = 60000;
      const MAX_CONTENT_SIZE = 500 * 1024 * 1024; // 500MB max

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await fetch(content, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Failed to fetch content: ${response.status} ${response.statusText}`);
        }

        // Check content-length before downloading to avoid excessive bandwidth usage
        const contentLength = response.headers.get("content-length");
        if (contentLength) {
          const size = parseInt(contentLength, 10);
          if (size > MAX_CONTENT_SIZE) {
            throw new Error(`Content size ${size} bytes exceeds maximum allowed ${MAX_CONTENT_SIZE} bytes`);
          }
        }

        const contentType = response.headers.get("content-type") || mimeType;
        mimeType = contentType;
        extension = getExtensionFromMime(contentType);

        const arrayBuffer = await response.arrayBuffer();

        // Double-check actual size after download
        if (arrayBuffer.byteLength > MAX_CONTENT_SIZE) {
          throw new Error(`Downloaded content size ${arrayBuffer.byteLength} bytes exceeds maximum allowed ${MAX_CONTENT_SIZE} bytes`);
        }

        buffer = Buffer.from(arrayBuffer);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
        }
        throw fetchError;
      }
    } else {
      // Handle base64 data URL
      const dataUrlMatch = content.match(/^data:([\w/+-]+);base64,/);
      if (dataUrlMatch) {
        mimeType = dataUrlMatch[1];
        extension = getExtensionFromMime(mimeType);
        const base64Data = content.replace(/^data:[\w/+-]+;base64,/, "");
        buffer = Buffer.from(base64Data, "base64");
      } else {
        // Fallback: assume it's raw base64 without data URL prefix
        extension = isVideo ? "mp4" : "png";
        buffer = Buffer.from(content, "base64");
      }
    }

    // Compute content hash for deduplication
    const contentHash = computeContentHash(buffer);

    // Check for existing file with same hash (deduplication)
    const existingFile = await findExistingFileByHash(resolvedDirectoryPath, contentHash, extension);
    const refs = await ensureProjectAndWorkflowRefs(projectId, workflowId);

    const persistAsset = async (storageId: string, fileName: string, fullPath: string) => {
      if (!isDatabaseConfigured() || !refs.projectId) {
        return;
      }

      const filePathForDb = toPublicUploadsPath(fullPath) || fullPath;

      await prisma.generatedAsset.upsert({
        where: { storageId },
        create: {
          storageId,
          projectId: refs.projectId,
          workflowId: refs.workflowId,
          type: isVideo ? "video" : "image",
          mimeType,
          fileName,
          filePath: filePathForDb,
          fileHash: contentHash,
          nodeId: typeof nodeId === "string" ? nodeId : null,
          prompt: typeof prompt === "string" ? prompt : null,
          modelId: typeof modelId === "string" ? modelId : null,
          cost,
        },
        update: {
          projectId: refs.projectId,
          workflowId: refs.workflowId,
          type: isVideo ? "video" : "image",
          mimeType,
          fileName,
          filePath: filePathForDb,
          fileHash: contentHash,
          nodeId: typeof nodeId === "string" ? nodeId : null,
          prompt: typeof prompt === "string" ? prompt : null,
          modelId: typeof modelId === "string" ? modelId : null,
          cost,
        },
      });
    };

    if (existingFile) {
      const existingPath = path.join(resolvedDirectoryPath, existingFile);
      const existingStorageId = existingFile.replace(`.${extension}`, '');
      logger.info('file.save', 'Generation deduplicated: existing file found', {
        contentHash,
        existingFile,
        filePath: existingPath,
      });

      await persistAsset(existingStorageId, existingFile, existingPath);

      return NextResponse.json({
        success: true,
        filePath: normalizePathForResponse(existingPath),
        publicPath: toPublicUploadsPath(existingPath),
        filename: existingFile,
        imageId: existingStorageId,
        isDuplicate: true,
      });
    }

    // Generate filename - use custom filename if provided, otherwise use prompt snippet
    let filename: string;
    if (customFilename) {
      // Sanitize custom filename
      const sanitizedFilename = customFilename
        .replace(/[^a-zA-Z0-9-_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      filename = `${sanitizedFilename}_${contentHash}.${extension}`;
    } else {
      const promptSnippet = prompt
        ? prompt
            .slice(0, 30)
            .replace(/[^a-zA-Z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "")
            .toLowerCase()
        : "generation";
      filename = `${promptSnippet}_${contentHash}.${extension}`;
    }
    const filePath = path.join(resolvedDirectoryPath, filename);

    // Write the file
    await fs.writeFile(filePath, buffer);
    const storageId = filename.replace(`.${extension}`, '');
    await persistAsset(storageId, filename, filePath);

    logger.info('file.save', 'Generation auto-saved successfully', {
      filePath,
      filename,
      fileSize: buffer.length,
      isVideo,
      contentHash,
    });

    return NextResponse.json({
      success: true,
      filePath: normalizePathForResponse(filePath),
      publicPath: toPublicUploadsPath(filePath),
      filename,
      imageId: storageId,
      isDuplicate: false,
    });
  } catch (error) {
    logger.error('file.error', 'Failed to save generation', {
      directoryPath,
      resolvedDirectoryPath,
      projectId,
      workflowId,
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
