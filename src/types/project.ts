export interface VideoProject {
  id: string;
  name: string;
  originalUri: string;
  thumbnailUri: string | null;
  duration: number;
  fileSize: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
}
