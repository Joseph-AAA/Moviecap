import {
  copyVideoToProject,
  createProjectDirectory,
  deleteProjectDirectory,
} from "@/services/videoStorage";

import {
  deleteProject as deleteProjectRecord,
  deleteProjectExport as deleteProjectExportRecord,
  saveProject,
} from "@/services/database";
import { createProjectThumbnail } from "@/services/thumbnailService";
import type { ProjectExport, VideoProject } from "@/types/project";
import { File } from "expo-file-system";

interface ImportedVideo {
  uri: string;
  fileName: string | null;
  duration: number | null;
  fileSize: number | null;
  width: number;
  height: number;
}

export async function createVideoProject(
  video: ImportedVideo,
): Promise<VideoProject> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    // 1. Create a permanent directory for this project.
    const projectDirectory = createProjectDirectory(id);

    // 2. Copy the original video into the project directory.
    const originalFile = await copyVideoToProject(
      video.uri,
      video.fileName,
      projectDirectory,
    );

    // 3. Generate and permanently store the thumbnail.
    const thumbnailUri = await createProjectThumbnail(
      originalFile.uri,
      projectDirectory,
    );

    // 4. Create the project metadata.
    const now = new Date().toISOString();

    const project: VideoProject = {
      id,
      name: video.fileName || "Untitled Project",
      originalUri: originalFile.uri,
      thumbnailUri,
      duration: video.duration ?? 0,
      fileSize: video.fileSize ?? originalFile.size ?? 0,
      width: video.width || null,
      height: video.height || null,
      createdAt: now,
      updatedAt: now,
    };

    // 5. Save the project record in SQLite.
    await saveProject(project);

    return project;
  } catch (error) {
    // Remove partially created files if project creation fails.
    try {
      deleteProjectDirectory(id);
    } catch (cleanupError) {
      console.warn("Project file cleanup failed:", cleanupError);
    }

    throw error;
  }
}

export async function removeVideoProject(id: string): Promise<void> {
  // Remove the database record first.
  await deleteProjectRecord(id);

  // Then remove the project's local files.
  try {
    deleteProjectDirectory(id);
  } catch (error) {
    console.warn("Failed to delete project files:", error);
    throw error;
  }
}

/**
 * Deletes an exported clip: the database record first, then the file.
 * A missing file (e.g. already removed) is not treated as an error.
 */
export async function removeProjectExport(
  projectExport: ProjectExport,
): Promise<void> {
  await deleteProjectExportRecord(projectExport.id, projectExport.projectId);

  try {
    const file = new File(projectExport.uri);

    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    console.warn("Failed to delete export file:", error);
  }
}
