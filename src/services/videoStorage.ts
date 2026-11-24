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
