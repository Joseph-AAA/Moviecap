/**
 * Web version of exportTrim.ts (Metro picks this file for web builds).
 *
 * react-native-video-trim is Android/iOS only: importing it on web crashes
 * the static web export ("Cannot read properties of undefined (reading
 * 'getEnforcing')"). Exporting needs the phone's native FFmpeg anyway, so
 * on web we explain that instead.
 */
export async function exportTrimmedRange(
  _sourceUri: string,
  _projectId: string,
  _start: number,
  _end: number,
): Promise<string> {
  throw new Error("Exporting videos works in the MovieCap phone app, not on the web version.");
}
