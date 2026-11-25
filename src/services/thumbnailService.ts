import { Directory, File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { createVideoPlayer, type VideoPlayer } from "expo-video";

function waitForVideoReady(player: VideoPlayer): Promise<void> {
  if (player.status === "readyToPlay") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const subscription = player.addListener(
      "statusChange",
      ({ status, error }) => {
        if (status === "readyToPlay") {
          subscription.remove();
          resolve();
        } else if (status === "error") {
          subscription.remove();
          reject(error ?? new Error("Video failed to load."));
        }
      },
    );
  });
}

export async function createProjectThumbnail(
  videoUri: string,
  projectDirectory: Directory,
): Promise<string | null> {
  let player: VideoPlayer | null = null;

  try {
    const videoFile = new File(videoUri);

    if (!videoFile.exists) {
      throw new Error("Original video file does not exist.");
    }

    const contentUri = videoFile.contentUri;

    player = createVideoPlayer(contentUri);

    await waitForVideoReady(player);

    const thumbnails = await player.generateThumbnailsAsync([1000], {
      maxWidth: 400,
    });

    const thumbnail = thumbnails[0];

    if (!thumbnail) {
      throw new Error("No thumbnail was generated.");
    }

    console.log("Thumbnail generated:", {
      width: thumbnail.width,
      height: thumbnail.height,
    });

    // Convert the native thumbnail reference into a JPEG file.
    const imageContext =
      ImageManipulator.ImageManipulator.manipulate(thumbnail);
    const renderedImage = await imageContext.renderAsync();

    const savedImage = await renderedImage.saveAsync({
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.85,
    });

    // Copy the JPEG into permanent project storage.
    const temporaryFile = new File(savedImage.uri);
    const permanentFile = new File(projectDirectory, "thumbnail.jpg");

    await temporaryFile.copy(permanentFile);

    if (!permanentFile.exists) {
      throw new Error("Permanent thumbnail file was not created.");
    }

    console.log("Thumbnail saved:", permanentFile.uri);
    console.log("Thumbnail size:", permanentFile.size);

    return permanentFile.uri;
  } catch (error) {
    console.warn("Thumbnail generation failed:", error);
    return null;
  } finally {
    player?.release();
  }
}
