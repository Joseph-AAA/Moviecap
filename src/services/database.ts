import type {
  ProjectExport,
  RecentExport,
  VideoProject,
} from "@/types/project";

import {
  parseEditConfig,
  parseMyDefaultPreset,
} from "@/services/timeline/editTimeline";
import type { EditConfig, MyDefaultPreset } from "@/types/edit";
import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "moviecap.db";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initializationPromise: Promise<void> | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME);
  }

  return databasePromise;
}

export async function initializeDatabase(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const db = await getDatabase();

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          originalUri TEXT NOT NULL,
          exportedUri TEXT,
          thumbnailUri TEXT,
          duration INTEGER NOT NULL,
          fileSize INTEGER NOT NULL,
          width INTEGER,
          height INTEGER,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);

      // Migrate existing databases without deleting project records.
      const columns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(projects)",
      );

      if (!columns.some((column) => column.name === "exportedUri")) {
        await db.execAsync("ALTER TABLE projects ADD COLUMN exportedUri TEXT;");
      }

      // Create a table for multiple exports per project.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS project_exports (
          id TEXT PRIMARY KEY NOT NULL,
          projectId TEXT NOT NULL,
          uri TEXT NOT NULL UNIQUE,
          duration REAL,
          createdAt TEXT NOT NULL,
          name TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_project_exports_projectId
        ON project_exports(projectId);
      `);

      // Add the clip name column to databases created before renaming existed.
      const exportColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(project_exports)",
      );

      if (!exportColumns.some((column) => column.name === "name")) {
        await db.execAsync("ALTER TABLE project_exports ADD COLUMN name TEXT;");
      }

      // Non-destructive edit settings (Default Edit, custom effects, audio,
      // subtitles) stored as JSON, one row per project. Media files are never
      // stored here, only file URIs.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS project_edits (
          projectId TEXT PRIMARY KEY NOT NULL,
          config TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);

      // App-wide settings (e.g. the user's My Default preset), JSON values.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
      `);

      // Migrate existing exported videos into the new table.
      await db.runAsync(`
        INSERT OR IGNORE INTO project_exports (
          id,
          projectId,
          uri,
          duration,
          createdAt
        )
        SELECT
          'legacy-' || id,
          id,
          exportedUri,
          NULL,
          datetime('now')
        FROM projects
        WHERE exportedUri IS NOT NULL;
      `);
    })().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  return initializationPromise;
}

export async function saveProject(project: VideoProject): Promise<void> {
  await initializeDatabase();
  const db = await getDatabase();

  await db.runAsync(
    `INSERT OR REPLACE INTO projects (
      id, name, originalUri, exportedUri, thumbnailUri,
      duration, fileSize, width, height, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    project.id,
    project.name,
    project.originalUri,
    project.exportedUri ?? null,
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
  await initializeDatabase();
  const db = await getDatabase();

  // exportCount = number of trimmed clips saved for each project.
  return db.getAllAsync<VideoProject>(
    `SELECT p.*,
       (SELECT COUNT(*) FROM project_exports e WHERE e.projectId = p.id)
         AS exportCount
     FROM projects p
     ORDER BY p.updatedAt DESC`,
  );
}

export async function getProjectById(id: string): Promise<VideoProject | null> {
  await initializeDatabase();
  const db = await getDatabase();

  return db.getFirstAsync<VideoProject>(
    "SELECT * FROM projects WHERE id = ?",
    id,
  );
}

export async function deleteProject(id: string): Promise<void> {
  await initializeDatabase();
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM project_exports WHERE projectId = ?", id);
    await db.runAsync("DELETE FROM project_edits WHERE projectId = ?", id);

    await db.runAsync("DELETE FROM projects WHERE id = ?", id);
  });
}

export async function updateProjectName(
  id: string,
  name: string,
): Promise<void> {
  await initializeDatabase();
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

export async function updateProjectExportedUri(
  id: string,
  exportedUri: string,
): Promise<void> {
  await initializeDatabase();
  const db = await getDatabase();

  await db.runAsync(
    `UPDATE projects
     SET exportedUri = ?, updatedAt = ?
     WHERE id = ?`,
    exportedUri,
    new Date().toISOString(),
    id,
  );
}

// Add a new exported video to a project.
export async function addProjectExport(
  projectId: string,
  uri: string,
  duration: number,
  name: string | null = null,
): Promise<void> {
  await initializeDatabase();
  const db = await getDatabase();

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO project_exports (
        id, projectId, uri, duration, createdAt, name
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      projectId,
      uri,
      duration,
      createdAt,
      name,
    );

    // Keep the old field updated for backward compatibility.
    await db.runAsync(
      `UPDATE projects
       SET exportedUri = ?, updatedAt = ?
       WHERE id = ?`,
      uri,
      createdAt,
      projectId,
    );
  });
}

// Retrieve all exported videos belonging to a project.
export async function getProjectExports(
  projectId: string,
): Promise<ProjectExport[]> {
  await initializeDatabase();
  const db = await getDatabase();

  return db.getAllAsync<ProjectExport>(
    `SELECT * FROM project_exports
     WHERE projectId = ?
     ORDER BY createdAt DESC`,
    projectId,
  );
}

// Load a project's saved edit settings, or null if none / unreadable.
export async function getProjectEdit(
  projectId: string,
): Promise<EditConfig | null> {
  await initializeDatabase();
  const db = await getDatabase();

  const row = await db.getFirstAsync<{ config: string }>(
    "SELECT config FROM project_edits WHERE projectId = ?",
    projectId,
  );

  if (!row) return null;

  const config = parseEditConfig(row.config);

  if (!config) {
    console.warn("Ignoring unreadable edit settings for project", projectId);
  }

  return config;
}

// Save (insert or replace) a project's edit settings.
export async function saveProjectEdit(
  projectId: string,
  config: EditConfig,
): Promise<void> {
  await initializeDatabase();
  const db = await getDatabase();

  await db.runAsync(
    `INSERT OR REPLACE INTO project_edits (projectId, config, updatedAt)
     VALUES (?, ?, ?)`,
    projectId,
    JSON.stringify(config),
    config.updatedAt,
  );
}

const MY_DEFAULT_KEY = "myDefaultPreset";

// The user's My Default preset, or null if not set up yet / unreadable.
export async function getMyDefaultPreset(): Promise<MyDefaultPreset | null> {
  await initializeDatabase();
  const db = await getDatabase();

  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = ?",
    MY_DEFAULT_KEY,
  );

  return row ? parseMyDefaultPreset(row.value) : null;
}

export async function saveMyDefaultPreset(preset: MyDefaultPreset): Promise<void> {
  await initializeDatabase();
  const db = await getDatabase();

  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value, updatedAt) VALUES (?, ?, ?)`,
    MY_DEFAULT_KEY,
    JSON.stringify(preset),
    preset.updatedAt,
  );
}

// Rename one exported clip. The project name is unaffected.
export async function updateProjectExportName(
  exportId: string,
  name: string,
): Promise<void> {
  await initializeDatabase();
  const db = await getDatabase();

  await db.runAsync(
    "UPDATE project_exports SET name = ? WHERE id = ?",
    name.trim(),
    exportId,
  );
}

// Retrieve one exported clip (used when opening a clip in the editor).
export async function getProjectExportById(
  exportId: string,
): Promise<ProjectExport | null> {
  await initializeDatabase();
  const db = await getDatabase();

  return db.getFirstAsync<ProjectExport>(
    "SELECT * FROM project_exports WHERE id = ?",
    exportId,
  );
}

// Retrieve the newest exported clips across all projects.
// Pass no limit to get every clip (SQLite treats LIMIT -1 as "no limit").
export async function getRecentExports(
  limit = -1,
): Promise<RecentExport[]> {
  await initializeDatabase();
  const db = await getDatabase();

  return db.getAllAsync<RecentExport>(
    `SELECT e.*, p.name AS projectName, p.thumbnailUri AS projectThumbnailUri
     FROM project_exports e
     JOIN projects p ON p.id = e.projectId
     ORDER BY e.createdAt DESC
     LIMIT ?`,
    limit,
  );
}

// Delete one exported video record without deleting the project.
// Also repoints projects.exportedUri at the newest remaining export (or NULL),
// otherwise the legacy migration would re-insert the deleted URI on next launch.
export async function deleteProjectExport(
  exportId: string,
  projectId: string,
): Promise<void> {
  await initializeDatabase();
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM project_exports WHERE id = ?", exportId);

    await db.runAsync(
      `UPDATE projects
       SET exportedUri = (
         SELECT uri FROM project_exports
         WHERE projectId = ?
         ORDER BY createdAt DESC
         LIMIT 1
       ),
       updatedAt = ?
       WHERE id = ?`,
      projectId,
      new Date().toISOString(),
      projectId,
    );
  });
}

// import type { VideoProject } from "@/types/project";
// import * as SQLite from "expo-sqlite";

// const DATABASE_NAME = "moviecap.db";

// let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
// let initializationPromise: Promise<void> | null = null;

// export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
//   if (!databasePromise) {
//     databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME);
//   }

//   return databasePromise;
// }

// export async function initializeDatabase(): Promise<void> {
//   if (!initializationPromise) {
//     initializationPromise = (async () => {
//       const db = await getDatabase();

//       await db.execAsync(`
//         CREATE TABLE IF NOT EXISTS projects (
//           id TEXT PRIMARY KEY NOT NULL,
//           name TEXT NOT NULL,
//           originalUri TEXT NOT NULL,
//           exportedUri TEXT,
//           thumbnailUri TEXT,
//           duration INTEGER NOT NULL,
//           fileSize INTEGER NOT NULL,
//           width INTEGER,
//           height INTEGER,
//           createdAt TEXT NOT NULL,
//           updatedAt TEXT NOT NULL
//         );
//       `);

//       // Migrate existing databases without deleting project records.
//       const columns = await db.getAllAsync<{ name: string }>(
//         "PRAGMA table_info(projects)",
//       );

//       if (!columns.some((column) => column.name === "exportedUri")) {
//         await db.execAsync("ALTER TABLE projects ADD COLUMN exportedUri TEXT;");
//       }

//       // Create a table for multiple exports per project.
//       await db.execAsync(`
//         CREATE TABLE IF NOT EXISTS project_exports (
//           id TEXT PRIMARY KEY NOT NULL,
//           projectId TEXT NOT NULL,
//           uri TEXT NOT NULL UNIQUE,
//           duration REAL,
//           createdAt TEXT NOT NULL
//         );

//         CREATE INDEX IF NOT EXISTS idx_project_exports_projectId
//         ON project_exports(projectId);
//       `);

//       // Migrate existing exported videos into the new table.
//       await db.runAsync(`
//         INSERT OR IGNORE INTO project_exports (
//           id,
//           projectId,
//           uri,
//           duration,
//           createdAt
//         )
//         SELECT
//           'legacy-' || id,
//           id,
//           exportedUri,
//           NULL,
//           datetime('now')
//         FROM projects
//         WHERE exportedUri IS NOT NULL;
//       `);
//     })().catch((error) => {
//       initializationPromise = null;
//       throw error;
//     });
//   }

//   return initializationPromise;
// }

// export async function saveProject(project: VideoProject): Promise<void> {
//   await initializeDatabase();
//   const db = await getDatabase();

//   await db.runAsync(
//     `INSERT OR REPLACE INTO projects (
//       id, name, originalUri, exportedUri, thumbnailUri,
//       duration, fileSize, width, height, createdAt, updatedAt
//     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//     project.id,
//     project.name,
//     project.originalUri,
//     project.exportedUri ?? null,
//     project.thumbnailUri,
//     project.duration,
//     project.fileSize,
//     project.width,
//     project.height,
//     project.createdAt,
//     project.updatedAt,
//   );
// }

// export async function getProjects(): Promise<VideoProject[]> {
//   await initializeDatabase();
//   const db = await getDatabase();

//   return db.getAllAsync<VideoProject>(
//     "SELECT * FROM projects ORDER BY updatedAt DESC",
//   );
// }

// export async function getProjectById(id: string): Promise<VideoProject | null> {
//   await initializeDatabase();
//   const db = await getDatabase();

//   return db.getFirstAsync<VideoProject>(
//     "SELECT * FROM projects WHERE id = ?",
//     id,
//   );
// }

// export async function deleteProject(id: string): Promise<void> {
//   await initializeDatabase();
//   const db = await getDatabase();

//   await db.runAsync("DELETE FROM projects WHERE id = ?", id);
// }

// export async function updateProjectName(
//   id: string,
//   name: string,
// ): Promise<void> {
//   await initializeDatabase();
//   const db = await getDatabase();

//   await db.runAsync(
//     `UPDATE projects
//      SET name = ?, updatedAt = ?
//      WHERE id = ?`,
//     name.trim(),
//     new Date().toISOString(),
//     id,
//   );
// }

// export async function updateProjectExportedUri(
//   id: string,
//   exportedUri: string,
// ): Promise<void> {
//   await initializeDatabase();
//   const db = await getDatabase();

//   await db.runAsync(
//     `UPDATE projects
//      SET exportedUri = ?, updatedAt = ?
//      WHERE id = ?`,
//     exportedUri,
//     new Date().toISOString(),
//     id,
//   );
// }
