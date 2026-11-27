import { trim } from "react-native-video-trim";

import { addProjectExport } from "@/services/database";
import { saveTrimmedVideo } from "@/services/videoStorage";

/**
 * Quick export of a time range WITHOUT effects (react-native-video-trim,
 * works in every app build). Saves the result as a new clip in the project;
 * the source video is only read.
 */
export async function exportTrimmedRange(
  sourceUri: string,
  projectId: string,
  start: number,
  end: number,
): Promise<string> {
  const result = await trim(sourceUri, {
    startTime: Math.round(start * 1000),
    endTime: Math.round(end * 1000),
    type: "video",
    outputExt: "mp4",
    saveToPhoto: false,
    removeAfterSavedToPhoto: false,
    removeAfterFailedToSavePhoto: false,
    enablePreciseTrimming: true,
    removeAudio: false,
    speed: 1.0,
  });

  if (!result.success || !result.outputPath) {
    throw new Error("The video trimming operation failed.");
  }

  const savedFile = await saveTrimmedVideo(result.outputPath, projectId);
  await addProjectExport(projectId, savedFile.uri, result.duration / 1000);
  return savedFile.uri;
}
