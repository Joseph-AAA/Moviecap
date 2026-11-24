import type { VideoProject } from "@/types/project";
import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "moviecap.db";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME);
  }

  return databasePromise;
}

export async function initializeDatabase(): Promise<void> {
  const db = await getDatabase();

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      originalUri TEXT NOT NULL,
      thumbnailUri TEXT,
      duration INTEGER NOT NULL,
      fileSize INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
}

export async function saveProject(project: VideoProject): Promise<void> {
  const db = await getDatabase();

  await db.runAsync(
    `INSERT OR REPLACE INTO projects (
      id, name, originalUri, thumbnailUri,
      duration, fileSize, width, height,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    project.id,
    project.name,
    project.originalUri,
    project.thumbnailUri,
    project.duration,
    project.fileSize,
    project.width,
    project.height,
    project.createdAt,
    project.updatedAt,
  );
}

export async function getProjects(): Promise<VideoProject[]> {
  const db = await getDatabase();

  return db.getAllAsync<VideoProject>(
    "SELECT * FROM projects ORDER BY updatedAt DESC",
  );
}

export async function getProjectById(id: string): Promise<VideoProject | null> {
  const db = await getDatabase();

  return db.getFirstAsync<VideoProject>(
    "SELECT * FROM projects WHERE id = ?",
    id,
  );
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDatabase();

  await db.runAsync("DELETE FROM projects WHERE id = ?", id);
}

export async function updateProjectName(
  id: string,
  name: string,
): Promise<void> {
  const db = await getDatabase();

  await db.runAsync(
    `UPDATE projects
     SET name = ?, updatedAt = ?
     WHERE id = ?`,
    name.trim(),
    new Date().toISOString(),
    id,
  );
}
