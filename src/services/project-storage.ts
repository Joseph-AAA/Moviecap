import { Directory, File, Paths } from "expo-file-system";
import * as VideoThumbnails from "expo-video-thumbnails";

import { saveProject } from "@/services/database";
import type { VideoProject } from "@/types/project";

export async function createVideoProject(video: {
  uri: string;
  fileName: string | null;
  duration: number | null;
  fileSize: number | null;
  width: number;
  height: number;
}): Promise<VideoProject> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const projectDirectory = new Directory(Paths.document, "projects", id);

  projectDirectory.create({ intermediates: true });

  const extension = video.fileName?.match(/\.[^/.]+$/)?.[0] || ".mp4";
  const originalFile = new File(projectDirectory, `original${extension}`);

  await new File(video.uri).copy(originalFile);

  let thumbnailUri: string | null = null;

  try {
    const thumbnail = await VideoThumbnails.getThumbnailAsync(
      originalFile.uri,
      { time: 1000 },
    );

    thumbnailUri = thumbnail.uri;
  } catch (error) {
    console.warn("Thumbnail generation failed:", error);
  }

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

  await saveProject(project);

  return project;
}
