import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import {
  getProjectGenerationsFsPath,
  resolveStorageDirectoryPath,
} from "@/lib/storagePaths";
import { logger } from "@/utils/logger";

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov'];

// Video extensions
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'];

// Extension to MIME type mapping
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

// POST: Load a generated image or video from the generations folder by ID
export async function POST(request: NextRequest) {
  let directoryPath: string | undefined;
  let resolvedDirectoryPath: string | undefined;
  let projectId: string | undefined;
  let imageId: string | undefined;
  try {
    const body = await request.json();
    directoryPath = body.directoryPath;
    projectId = body.projectId;
    imageId = body.imageId;
    resolvedDirectoryPath = directoryPath
      ? resolveStorageDirectoryPath(directoryPath)
      : projectId
      ? getProjectGenerationsFsPath(projectId)
      : undefined;

    logger.info('file.load', 'Generation load request received', {
      directoryPath,
      resolvedDirectoryPath,
      projectId,
      imageId,
    });

    if (!resolvedDirectoryPath || !imageId) {
      logger.warn('file.load', 'Generation load validation failed: missing fields', {
        hasDirectoryPath: !!resolvedDirectoryPath,
        hasImageId: !!imageId,
      });
      return NextResponse.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate directory exists
    try {
      const stats = await fs.stat(resolvedDirectoryPath);
      if (!stats.isDirectory()) {
        logger.warn('file.error', 'Generation load failed: path is not a directory', {
          directoryPath: resolvedDirectoryPath,
        });
        return NextResponse.json(
          { success: false, error: "Path is not a directory" },
          { status: 400 }
        );
      }
    } catch (dirError) {
      logger.warn('file.error', 'Generation load failed: directory does not exist', {
        directoryPath: resolvedDirectoryPath,
      });
      return NextResponse.json(
        { success: false, error: "Directory does not exist" },
        { status: 400 }
      );
    }

    // Find the file by ID with any supported extension
    let foundExtension: string | null = null;
    let filePath: string | null = null;

    for (const ext of SUPPORTED_EXTENSIONS) {
      const candidatePath = path.join(resolvedDirectoryPath, `${imageId}.${ext}`);
      try {
        await fs.access(candidatePath);
        foundExtension = ext;
        filePath = candidatePath;
        break;
      } catch {
        // File doesn't exist with this extension, continue
      }
    }

    if (!foundExtension || !filePath) {
      // Return 200 with success: false to avoid Next.js error overlay
      // Missing files are expected when workflow refs point to deleted/moved images
      logger.info('file.load', 'Generation file not found (expected for missing refs)', {
        imageId,
        directoryPath: resolvedDirectoryPath,
      });
      return NextResponse.json({
        success: false,
        error: "File not found",
        notFound: true,
      });
    }

    // Read the file
    const buffer = await fs.readFile(filePath);

    // Convert to base64 data URL
    const mimeType = EXT_TO_MIME[foundExtension] || 'application/octet-stream';
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Determine content type
    const isVideo = VIDEO_EXTENSIONS.includes(foundExtension);
    const contentType = isVideo ? 'video' : 'image';

    logger.info('file.load', 'Generation loaded successfully', {
      filePath,
      extension: foundExtension,
      contentType,
      fileSize: buffer.length,
    });

    // Return appropriate response field based on content type
    const response: Record<string, unknown> = {
      success: true,
      contentType,
    };

    if (isVideo) {
      response.video = dataUrl;
    } else {
      response.image = dataUrl;
    }

    return NextResponse.json(response);
  } catch (error) {
    logger.error('file.error', 'Failed to load generation', {
      directoryPath,
      resolvedDirectoryPath,
      projectId,
      imageId,
    }, error instanceof Error ? error : undefined);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Load failed",
      },
      { status: 500 }
    );
  }
}
