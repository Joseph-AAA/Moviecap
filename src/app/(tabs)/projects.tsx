import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MovieCapColors as C } from "@/constants/theme";
import { getProjects } from "@/services/database";
import { projectsStyles as styles } from "@/styles/projects.styles";
import type { VideoProject } from "@/types/project";

export default function ProjectsScreen() {
  const router = useRouter();

  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadProjects = async () => {
        try {
          const savedProjects = await getProjects();

          if (isActive) {
            setProjects(savedProjects);
          }
        } catch (error) {
          console.error("Failed to load projects:", error);
        } finally {
          if (isActive) {
            setIsLoading(false);
          }
        }
      };

      setIsLoading(true);
      loadProjects();

      return () => {
        isActive = false;
      };
    }, []),
  );

  const formatDuration = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
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
              <Pressable
                key={project.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: C.card,
                  borderRadius: 16,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: C.border,
                  gap: 14,
                }}
                onPress={() => {
                  console.log("Selected project:", project.id);
                }}
              >
                {project.thumbnailUri ? (
                  <Image
                    source={{ uri: project.thumbnailUri }}
                    style={{
                      width: 100,
                      height: 76,
                      borderRadius: 10,
                      backgroundColor: C.elevated,
                    }}
                    resizeMode="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 100,
                      height: 76,
                      borderRadius: 10,
                      backgroundColor: C.elevated,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontSize: 28 }}>🎬</Text>
                  </View>
                )}

                <View style={{ flex: 1, gap: 6 }}>
                  <Text
                    style={{
                      color: C.text,
                      fontWeight: "700",
                      fontSize: 15,
                    }}
                    numberOfLines={1}
                  >
                    {project.name}
                  </Text>

                  <Text style={{ color: C.secondaryText, fontSize: 12 }}>
                    {formatDuration(project.duration)} ·{" "}
                    {formatFileSize(project.fileSize)}
                  </Text>

                  <Text style={{ color: C.primaryLight, fontSize: 12 }}>
                    Saved locally
                  </Text>
                </View>
              </Pressable>
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
    </SafeAreaView>
  );
}
