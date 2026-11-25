import VideoPreview from "@/components/editor/VideoPreview";
import { MovieCapColors as C } from "@/constants/theme";
import { getProjectById } from "@/services/database";
import type { VideoProject } from "@/types/project";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function EditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [project, setProject] = useState<VideoProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    const loadProject = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const savedProject = await getProjectById(id);

        if (!savedProject) {
          throw new Error("Project not found.");
        }

        if (isActive) {
          setProject(savedProject);
        }
      } catch (err) {
        console.error("Failed to load project:", err);

        if (isActive) {
          setError("Could not load this project.");
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    if (id) {
      void loadProject();
    }

    return () => {
      isActive = false;
    };
  }, [id]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <Text style={styles.headerTitle} numberOfLines={1}>
          {project?.name ?? "Video Editor"}
        </Text>

        <View style={styles.headerSpacer} />
      </View>

      {isLoading ? (
        <ActivityIndicator
          size="large"
          color={C.primary}
          style={styles.loader}
        />
      ) : error ? (
        <View style={styles.messageContainer}>
          <Text style={styles.message}>{error}</Text>
        </View>
      ) : project ? (
        <View style={styles.content}>
          <VideoPreview uri={project.originalUri} />

          <View style={styles.info}>
            <Text style={styles.projectName}>{project.name}</Text>
            <Text style={styles.subtitle}>
              Your video is ready for editing.
            </Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
  },
  backText: {
    color: C.text,
    fontSize: 34,
  },
  headerTitle: {
    flex: 1,
    color: C.text,
    fontSize: 17,
    fontWeight: "700",
  },
  headerSpacer: {
    width: 40,
  },
  loader: {
    flex: 1,
  },
  messageContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  message: {
    color: C.text,
    fontSize: 15,
  },
  content: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  info: {
    gap: 6,
  },
  projectName: {
    color: C.text,
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: C.secondaryText,
    fontSize: 13,
  },
});
