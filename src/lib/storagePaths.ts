import * as path from "path";

const DEFAULT_UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

function normalizeSlashes(input: string): string {
  return input.replace(/\\/g, "/");
}

export function getUploadsRoot(): string {
  const configuredRoot = process.env.UPLOADS_ROOT?.trim();
  if (!configuredRoot) {
    return DEFAULT_UPLOADS_ROOT;
  }

  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.join(process.cwd(), configuredRoot);
}

export function getProjectGenerationsPublicPath(projectId: string): string {
  return `/uploads/${projectId}/generations`;
}

export function getProjectOutputsPublicPath(projectId: string): string {
  return `/uploads/${projectId}/outputs`;
}

export function getProjectGenerationsFsPath(projectId: string): string {
  return path.join(getUploadsRoot(), projectId, "generations");
}

export function getProjectOutputsFsPath(projectId: string): string {
  return path.join(getUploadsRoot(), projectId, "outputs");
}

export function isAbsoluteFsPath(inputPath: string): boolean {
  return path.isAbsolute(inputPath);
}

export function resolveStorageDirectoryPath(inputPath: string): string {
  const normalized = normalizeSlashes(inputPath).trim();
  if (!normalized) {
    throw new Error("Storage path is empty");
  }

  if (normalized.startsWith("/uploads/")) {
    const relativeUploadPath = normalized.replace(/^\/uploads\//, "");
    return path.join(getUploadsRoot(), relativeUploadPath);
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  throw new Error("Storage path must be absolute or start with /uploads/");
}

export function toPublicUploadsPath(absolutePath: string): string | null {
  const root = normalizeSlashes(path.resolve(getUploadsRoot()));
  const absolute = normalizeSlashes(path.resolve(absolutePath));

  if (!absolute.startsWith(root)) {
    return null;
  }

  const relativePath = absolute.slice(root.length).replace(/^\/+/, "");
  return `/uploads/${relativePath}`;
}
