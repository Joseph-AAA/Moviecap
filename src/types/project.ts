export interface VideoProject {
  id: string;
  name: string;
  originalUri: string;
  exportedUri?: string | null;
  /** Number of trimmed clips; only filled in by getProjects(). */
  exportCount?: number;
  thumbnailUri: string | null;
  duration: number;
  fileSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectExport {
  id: string;
  projectId: string;
  uri: string;
  duration: number | null;
  createdAt: string;
  /** User-given clip name; null until renamed (UI falls back to the project name). */
  name: string | null;
}

/** An export joined with its project's name and thumbnail. */
export interface RecentExport extends ProjectExport {
  projectName: string;
  projectThumbnailUri: string | null;
}
