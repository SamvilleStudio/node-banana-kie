#!/usr/bin/env node

/* eslint-disable no-console */

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const JSON_EXTENSION = ".json";
const DEFAULT_UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");
const IMPORTABLE_ASSET_DIRS = ["generations", "outputs"];
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "public",
]);

let prismaClient = null;

function getPrisma() {
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return prismaClient;
}

function printUsage() {
  console.log(`
Import legacy filesystem workflows into PostgreSQL.

Usage:
  node scripts/import-legacy-workflows.js --source <path> [options]

Required:
  --source <path>          File or directory containing workflow JSON files.

Options:
  --project-name <name>    Force all imported workflows into a single project name.
  --project-id <id>        Force all imported workflows into a single project ID.
  --uploads-root <path>    Override uploads root (default: UPLOADS_ROOT env or public/uploads).
  --no-recursive           Do not recurse when --source is a directory.
  --dry-run                Show what would be imported without writing DB/files.
  --verbose                Print each imported workflow and asset.
  --help                   Show this message.

Examples:
  node scripts/import-legacy-workflows.js --source ./examples
  node scripts/import-legacy-workflows.js --source "D:/old-projects" --project-name "Imported Projects"
  node scripts/import-legacy-workflows.js --source ./legacy --dry-run --verbose
`);
}

function parseArgs(argv) {
  const options = {
    source: "",
    projectName: null,
    projectId: null,
    uploadsRoot: null,
    recursive: true,
    dryRun: false,
    verbose: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (arg === "--no-recursive") {
      options.recursive = false;
      continue;
    }

    const nextArg = argv[index + 1];
    if (!nextArg) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--source") {
      options.source = nextArg;
      index += 1;
      continue;
    }
    if (arg === "--project-name") {
      options.projectName = nextArg.trim();
      index += 1;
      continue;
    }
    if (arg === "--project-id") {
      options.projectId = nextArg.trim();
      index += 1;
      continue;
    }
    if (arg === "--uploads-root") {
      options.uploadsRoot = nextArg.trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function hashString(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("md5").update(content).digest("hex");
}

function sanitizeId(rawValue) {
  return rawValue.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function resolveUploadsRoot(optionUploadsRoot) {
  const configured = optionUploadsRoot || process.env.UPLOADS_ROOT?.trim();
  if (!configured) {
    return DEFAULT_UPLOADS_ROOT;
  }
  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isWorkflowPayload(parsed) {
  return (
    !!parsed &&
    typeof parsed === "object" &&
    Array.isArray(parsed.nodes) &&
    Array.isArray(parsed.edges)
  );
}

async function collectJsonCandidates(sourcePath, recursive) {
  const stats = await fs.stat(sourcePath);
  if (stats.isFile()) {
    if (path.extname(sourcePath).toLowerCase() !== JSON_EXTENSION) {
      return [];
    }
    return [sourcePath];
  }

  const collected = [];

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!recursive) {
          continue;
        }
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === JSON_EXTENSION) {
        collected.push(fullPath);
      }
    }
  }

  await walk(sourcePath);
  return collected;
}

async function collectWorkflowFiles(sourcePath, recursive, verbose) {
  const jsonCandidates = await collectJsonCandidates(sourcePath, recursive);
  const workflows = [];

  for (const candidate of jsonCandidates) {
    try {
      const raw = await fs.readFile(candidate, "utf-8");
      const parsed = JSON.parse(raw);
      if (!isWorkflowPayload(parsed)) {
        continue;
      }
      workflows.push({
        filePath: candidate,
        directory: path.dirname(candidate),
        payload: parsed,
      });
    } catch (error) {
      if (verbose) {
        console.warn(`[skip] ${candidate}: ${error instanceof Error ? error.message : "Failed to parse"}`);
      }
    }
  }

  return workflows;
}

function defaultProjectIdForDirectory(directoryPath) {
  return `legacy_proj_${hashString(path.resolve(directoryPath)).slice(0, 12)}`;
}

function defaultProjectNameForDirectory(directoryPath) {
  const baseName = path.basename(directoryPath).trim();
  return baseName || "Imported Project";
}

async function resolveWorkflowId(candidateId, workflowPath, projectId, dryRun) {
  const base = sanitizeId(
    candidateId && typeof candidateId === "string" && candidateId.trim().length > 0
      ? candidateId.trim()
      : `legacy_wf_${hashString(path.resolve(workflowPath)).slice(0, 16)}`
  );

  if (dryRun) {
    return base;
  }

  const prisma = getPrisma();
  let nextId = base;
  let attempt = 0;

  while (true) {
    const existing = await prisma.workflow.findUnique({
      where: { id: nextId },
      select: { projectId: true },
    });
    if (!existing || existing.projectId === projectId) {
      return nextId;
    }
    attempt += 1;
    nextId = `${base}_${attempt}`;
  }
}

async function collectFilesRecursively(directoryPath) {
  const files = [];
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFilesRecursively(fullPath);
      files.push(...nested);
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function getMimeTypeFromExtension(extension) {
  const normalized = extension.toLowerCase();
  return MIME_TYPES[normalized] || "application/octet-stream";
}

function deriveStorageId(fileName, sourcePath) {
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  if (/_[a-f0-9]{32}$/i.test(base)) {
    return base;
  }
  return `${base}_${hashString(path.resolve(sourcePath)).slice(0, 8)}`;
}

async function resolveUniqueStorageId(baseStorageId, projectId, dryRun) {
  if (dryRun) {
    return baseStorageId;
  }

  const prisma = getPrisma();
  let nextStorageId = baseStorageId;
  let attempt = 0;

  while (true) {
    const existing = await prisma.generatedAsset.findUnique({
      where: { storageId: nextStorageId },
      select: { projectId: true },
    });

    if (!existing || existing.projectId === projectId) {
      return nextStorageId;
    }

    attempt += 1;
    nextStorageId = `${baseStorageId}_${attempt}`;
  }
}

async function importProjectAssets({
  projectDirectory,
  projectId,
  uploadsRoot,
  dryRun,
  verbose,
}) {
  const prisma = dryRun ? null : getPrisma();
  let importedCount = 0;

  for (const assetFolder of IMPORTABLE_ASSET_DIRS) {
    const sourceFolder = path.join(projectDirectory, assetFolder);
    if (!(await pathExists(sourceFolder))) {
      continue;
    }

    const sourceStat = await fs.stat(sourceFolder);
    if (!sourceStat.isDirectory()) {
      continue;
    }

    const sourceFiles = await collectFilesRecursively(sourceFolder);
    for (const sourceFilePath of sourceFiles) {
      const extension = path.extname(sourceFilePath).replace(".", "").toLowerCase();
      if (!MIME_TYPES[extension]) {
        continue;
      }

      const relativeAssetPath = normalizeSlashes(path.relative(sourceFolder, sourceFilePath));
      const destinationPath = path.join(uploadsRoot, projectId, assetFolder, relativeAssetPath);
      const destinationDir = path.dirname(destinationPath);
      const destinationPublicPath = `/uploads/${projectId}/${assetFolder}/${relativeAssetPath}`;

      const storageIdBase = deriveStorageId(path.basename(sourceFilePath), sourceFilePath);
      const storageId = await resolveUniqueStorageId(storageIdBase, projectId, dryRun);
      const type = VIDEO_EXTENSIONS.has(extension) ? "video" : "image";
      const mimeType = getMimeTypeFromExtension(extension);

      if (!dryRun) {
        await fs.mkdir(destinationDir, { recursive: true });
        await fs.copyFile(sourceFilePath, destinationPath);
      }

      const fileHash = dryRun ? "dry-run" : await hashFile(destinationPath);

      if (!dryRun && prisma) {
        await prisma.generatedAsset.upsert({
          where: { storageId },
          create: {
            storageId,
            projectId,
            workflowId: null,
            runId: null,
            type,
            mimeType,
            fileName: path.basename(destinationPath),
            filePath: destinationPublicPath,
            fileHash,
            nodeId: null,
            prompt: null,
            modelId: null,
            cost: null,
          },
          update: {
            projectId,
            workflowId: null,
            runId: null,
            type,
            mimeType,
            fileName: path.basename(destinationPath),
            filePath: destinationPublicPath,
            fileHash,
            nodeId: null,
            prompt: null,
            modelId: null,
            cost: null,
          },
        });
      }

      importedCount += 1;
      if (verbose) {
        console.log(`[asset] ${sourceFilePath} -> ${destinationPublicPath} (${storageId})`);
      }
    }
  }

  return importedCount;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!options.source) {
    throw new Error("--source is required");
  }

  if (!options.dryRun && !process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for imports. Use --dry-run to preview.");
  }

  const sourcePath = path.resolve(options.source);
  const uploadsRoot = resolveUploadsRoot(options.uploadsRoot);

  const workflows = await collectWorkflowFiles(sourcePath, options.recursive, options.verbose);
  if (workflows.length === 0) {
    console.log("No workflow JSON files found.");
    return;
  }

  const groupedByDirectory = new Map();
  for (const workflow of workflows) {
    const key = options.projectId || options.projectName
      ? "__forced_project__"
      : workflow.directory;

    const existing = groupedByDirectory.get(key);
    if (existing) {
      existing.push(workflow);
    } else {
      groupedByDirectory.set(key, [workflow]);
    }
  }

  if (!options.dryRun) {
    await fs.mkdir(uploadsRoot, { recursive: true });
  }

  const summary = {
    projectCount: 0,
    workflowCount: 0,
    assetCount: 0,
  };

  for (const [groupKey, projectWorkflows] of groupedByDirectory.entries()) {
    const sourceDirectory = groupKey === "__forced_project__"
      ? sourcePath
      : groupKey;

    const projectId = sanitizeId(
      options.projectId && options.projectId.length > 0
        ? options.projectId
        : defaultProjectIdForDirectory(sourceDirectory)
    );

    const projectName = (options.projectName && options.projectName.length > 0)
      ? options.projectName
      : defaultProjectNameForDirectory(sourceDirectory);

    const description = `Imported from ${normalizeSlashes(sourceDirectory)} on ${new Date().toISOString()}`;

    if (options.dryRun) {
      console.log(`[project:dry-run] ${projectName} (${projectId})`);
    } else {
      const prisma = getPrisma();
      await prisma.project.upsert({
        where: { id: projectId },
        create: {
          id: projectId,
          name: projectName,
          description,
        },
        update: {
          name: projectName,
          description,
        },
      });
    }

    summary.projectCount += 1;

    for (const workflowFile of projectWorkflows) {
      const workflowName =
        typeof workflowFile.payload.name === "string" && workflowFile.payload.name.trim().length > 0
          ? workflowFile.payload.name.trim()
          : path.basename(workflowFile.filePath, JSON_EXTENSION);

      const workflowId = await resolveWorkflowId(
        workflowFile.payload.id,
        workflowFile.filePath,
        projectId,
        options.dryRun
      );

      const workflowVersion =
        typeof workflowFile.payload.version === "number" ? workflowFile.payload.version : 1;

      const workflowData = {
        ...workflowFile.payload,
        id: workflowId,
        name: workflowName,
        version: workflowVersion,
      };

      if (options.dryRun) {
        console.log(`[workflow:dry-run] ${workflowFile.filePath} -> ${workflowId}`);
      } else {
        const prisma = getPrisma();
        await prisma.workflow.upsert({
          where: { id: workflowId },
          create: {
            id: workflowId,
            projectId,
            name: workflowName,
            version: workflowVersion,
            data: workflowData,
          },
          update: {
            projectId,
            name: workflowName,
            version: workflowVersion,
            data: workflowData,
          },
        });
      }

      summary.workflowCount += 1;

      if (options.verbose) {
        console.log(`[workflow] ${workflowFile.filePath} -> project ${projectId}`);
      }
    }

    const assetDirectories = groupKey === "__forced_project__"
      ? [...new Set(projectWorkflows.map((item) => item.directory))]
      : [sourceDirectory];

    for (const assetDirectory of assetDirectories) {
      const importedAssets = await importProjectAssets({
        projectDirectory: assetDirectory,
        projectId,
        uploadsRoot,
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
      summary.assetCount += importedAssets;
    }
  }

  console.log("");
  console.log("Import complete.");
  console.log(`Projects:  ${summary.projectCount}`);
  console.log(`Workflows: ${summary.workflowCount}`);
  console.log(`Assets:    ${summary.assetCount}`);
  console.log(`Uploads:   ${uploadsRoot}`);
  console.log(options.dryRun ? "Mode:      dry-run" : "Mode:      write");
}

main()
  .catch((error) => {
    console.error(`Import failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prismaClient) {
      await prismaClient.$disconnect();
    }
  });
