import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ProjectCard from "@/components/projects/ProjectCard";
import RenameProjectModal from "@/components/projects/RenameProjectModal";
import { MovieCapColors as C } from "@/constants/theme";
import { getProjects, updateProjectName } from "@/services/database";
import { removeVideoProject } from "@/services/project-storage";
import { projectsStyles as styles } from "@/styles/projects.styles";
import type { VideoProject } from "@/types/project";

export default function ProjectsScreen() {
  const router = useRouter();

  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedProject, setSelectedProject] = useState<VideoProject | null>(
    null,
  );

  const [isRenameVisible, setIsRenameVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null,
  );

  // Load projects from SQLite.
  const loadProjects = useCallback(async () => {
    const savedProjects = await getProjects();
    setProjects(savedProjects);
  }, []);

  // Refresh the list whenever this screen becomes active.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const load = async () => {
        try {
          const savedProjects = await getProjects();

          if (isActive) {
            setProjects(savedProjects);
          }
        } catch (error) {
          console.error("Failed to load projects:", error);

          if (isActive) {
            Alert.alert("Error", "Could not load your projects.");
          }
        } finally {
          if (isActive) {
            setIsLoading(false);
          }
        }
      };

      setIsLoading(true);
      void load();

      return () => {
        isActive = false;
      };
    }, []),
  );

  // Open rename modal.
  const handleOpenRename = (project: VideoProject) => {
    setSelectedProject(project);
    setIsRenameVisible(true);
  };

  // Close rename modal.
  const handleCloseRename = () => {
    if (isSaving) return;

    setIsRenameVisible(false);
    setSelectedProject(null);
  };

  // Save the updated project name.
  const handleRename = async (newName: string) => {
    if (!selectedProject || isSaving) return;

    try {
      setIsSaving(true);

      await updateProjectName(selectedProject.id, newName);

      await loadProjects();

      setIsRenameVisible(false);
      setSelectedProject(null);

      Alert.alert("Success", "Project renamed successfully.");
    } catch (error) {
      console.error("Failed to rename project:", error);

      Alert.alert("Error", "Could not rename this project.");
    } finally {
      setIsSaving(false);
    }
  };

  // Ask for confirmation before deleting.
  const handleDelete = (project: VideoProject) => {
    Alert.alert(
      "Delete Project",
      `Are you sure you want to delete "${project.name}"? This will permanently remove its video and thumbnail from your device.`,
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void confirmDelete(project);
          },
        },
      ],
    );
  };

  // Delete the project and its local files.
  const confirmDelete = async (project: VideoProject) => {
    if (deletingProjectId) return;

    try {
      setDeletingProjectId(project.id);

      await removeVideoProject(project.id);

      await loadProjects();

      Alert.alert("Deleted", "Project deleted successfully.");
    } catch (error) {
      console.error("Failed to delete project:", error);

      Alert.alert(
        "Deletion incomplete",
        "Could not completely delete this project. Please check your device storage.",
      );
    } finally {
      setDeletingProjectId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>My Projects</Text>
            <Text style={styles.subtitle}>
              All your creative work in one place.
            </Text>
          </View>

          <View style={styles.countBadge}>
            <Text style={styles.countText}>{projects.length}</Text>
          </View>
        </View>

        {/* New Project Card */}
        <Pressable
          style={styles.newProjectCard}
          onPress={() => router.push("/import-video")}
        >
          <View style={styles.plusIcon}>
            <Text style={styles.plusText}>+</Text>
          </View>

          <View style={styles.newProjectInfo}>
            <Text style={styles.newProjectTitle}>Create New Project</Text>

            <Text style={styles.newProjectDescription}>
              Start editing a new video
            </Text>
          </View>

          <Text style={styles.arrow}>›</Text>
        </Pressable>

        {/* Project Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>YOUR WORK</Text>
          <Text style={styles.sortText}>Recently edited</Text>
        </View>

        {isLoading ? (
          <ActivityIndicator
            size="large"
            color={C.primary}
            style={{ marginTop: 40 }}
          />
        ) : projects.length === 0 ? (
          /* Empty State */
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Text style={styles.folderIcon}>▱</Text>
            </View>

            <Text style={styles.emptyTitle}>No projects yet</Text>

            <Text style={styles.emptyDescription}>
              Your video projects will appear here. Start creating your first
              project and bring your stories to life.
            </Text>
          </View>
        ) : (
          /* Saved Projects */
          <View style={{ gap: 14 }}>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onPress={() => {
                  router.push(`../editor/${project.id}`);
                }}
                onRename={handleOpenRename}
                onDelete={handleDelete}
              />
            ))}
          </View>
        )}

        {/* Storage Information */}
        <View style={styles.storageCard}>
          <Text style={styles.storageTitle}>LOCAL STORAGE</Text>

          <Text style={styles.storageDescription}>
            Your projects are stored on your device.
          </Text>

          <Text style={styles.storageStatus}>
            {projects.length} {projects.length === 1 ? "project" : "projects"}{" "}
            created
          </Text>
        </View>
      </ScrollView>

      {/* Rename Project Modal */}
      <RenameProjectModal
        visible={isRenameVisible}
        project={selectedProject}
        isSaving={isSaving}
        onClose={handleCloseRename}
        onSave={handleRename}
      />
    </SafeAreaView>
  );
}
