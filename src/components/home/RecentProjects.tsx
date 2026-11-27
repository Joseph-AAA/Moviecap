import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";
import { getProjects } from "@/services/database";
import { homeStyles as styles } from "@/styles/home.styles";
import type { VideoProject } from "@/types/project";

export default function RecentProjects() {
  const router = useRouter();

  const [projects, setProjects] = useState<VideoProject[]>([]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadProjects = async () => {
        try {
          const savedProjects = await getProjects();

          if (isActive) {
            setProjects(savedProjects.slice(0, 3));
          }
        } catch (error) {
          console.error("Failed to load recent projects:", error);
        }
      };

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

  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>RECENT PROJECTS</Text>

        <Pressable onPress={() => router.push("/(tabs)/projects")}>
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      </View>

      {projects.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🎬</Text>

          <Text style={styles.emptyTitle}>No projects yet</Text>

          <Text style={styles.emptyDescription}>
            Your video projects will appear here. Start your first project
            today!
          </Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {projects.map((project) => (
            <Pressable
              key={project.id}
              onPress={() =>
                router.push({
                  pathname: "/editor/[id]",
                  params: { id: project.id },
                })
              }
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: C.card,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: C.border,
                padding: 12,
                gap: 12,
              }}
            >
              {project.thumbnailUri ? (
                <Image
                  source={{ uri: project.thumbnailUri }}
                  style={{
                    width: 76,
                    height: 64,
                    borderRadius: 10,
                    backgroundColor: C.elevated,
                  }}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={{
                    width: 76,
                    height: 64,
                    borderRadius: 10,
                    backgroundColor: C.elevated,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 26 }}>🎬</Text>
                </View>
              )}

              <View style={{ flex: 1, gap: 5 }}>
                <Text
                  style={{
                    color: C.text,
                    fontSize: 14,
                    fontWeight: "700",
                  }}
                  numberOfLines={1}
                >
                  {project.name}
                </Text>

                <Text style={{ color: C.secondaryText, fontSize: 12 }}>
                  {formatDuration(project.duration)} ·{" "}
                  {(project.fileSize / (1024 * 1024)).toFixed(2)} MB
                </Text>

                {!!project.exportCount && (
                  <Text style={{ color: C.primaryLight, fontSize: 12 }}>
                    ✂ {project.exportCount} trimmed{" "}
                    {project.exportCount === 1 ? "clip" : "clips"}
                  </Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
