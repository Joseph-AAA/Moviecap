import { Directory, File, Paths } from "expo-file-system";

/**
 * Creates and returns the directory used to store one video project.
 */
export function createProjectDirectory(projectId: string): Directory {
  const directory = new Directory(Paths.document, "projects", projectId);

  directory.create({
    intermediates: true,
    idempotent: true,
  });

  return directory;
}

/**
 * Copies an imported video into its project directory.
 */
export async function copyVideoToProject(
  sourceUri: string,
  fileName: string | null,
  projectDirectory: Directory,
): Promise<File> {
  const extension = fileName?.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? ".mp4";

  const destination = new File(projectDirectory, `original${extension}`);

  await new File(sourceUri).copy(destination);

  return destination;
}

/**
 * Deletes all files belonging to a project.
 */
export function deleteProjectDirectory(projectId: string): void {
  const directory = new Directory(Paths.document, "projects", projectId);

  if (directory.exists) {
    directory.delete();
  }
}

/**
 * Moves an exported video into its project directory.
 * The trim library writes to the app's files directory and never cleans up,
 * so moving (not copying) avoids leaving a duplicate behind on every export.
 */
export async function saveTrimmedVideo(
  sourceUri: string,
  projectId: string,
): Promise<File> {
  const projectDirectory = createProjectDirectory(projectId);

  const source = sourceUri.startsWith("file://")
    ? new File(sourceUri)
    : new File(`file://${sourceUri}`);

  const destination = new File(projectDirectory, `trimmed-${Date.now()}.mp4`);

  await source.move(destination);

  return source;
}

/**
 * Lists all trimmed video files saved inside a project directory.
 */
export function getTrimmedVideos(projectId: string): File[] {
  const projectDirectory = new Directory(Paths.document, "projects", projectId);

  if (!projectDirectory.exists) {
    return [];
  }

  return projectDirectory
    .list()
    .filter(
      (item): item is File =>
        item instanceof File && /^trimmed-.*\.mp4$/i.test(item.name),
    );
}
