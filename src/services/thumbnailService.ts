import { Directory, File } from "expo-file-system";
import * as VideoThumbnails from "expo-video-thumbnails";

/**
 * Generates a thumbnail and stores it inside the project directory.
 */
export async function createProjectThumbnail(
  videoUri: string,
  projectDirectory: Directory,
): Promise<string | null> {
  try {
    const thumbnail = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time: 1000,
    });

    const temporaryFile = new File(thumbnail.uri);
    const permanentFile = new File(projectDirectory, "thumbnail.jpg");

    await temporaryFile.copy(permanentFile);

    return permanentFile.uri;
  } catch (error) {
    console.warn("Thumbnail generation failed:", error);
    return null;
  }
}
