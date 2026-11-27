import DefaultEditPanel from "@/components/editor/DefaultEditPanel";
import RenderEditCard from "@/components/editor/RenderEditCard";
import VideoPreview from "@/components/editor/VideoPreview";
import { MovieCapColors as C } from "@/constants/theme";
import {
  getProjectById,
  getProjectEdit,
  getProjectExportById,
  saveProjectEdit,
} from "@/services/database";
import {
  applyDefaultEdit,
  buildTimeline,
  createEmptyEditConfig,
  resolveFreezes,
  unapplyDefaultEdit,
} from "@/services/timeline/editTimeline";
import type { EditConfig } from "@/types/edit";
import type { ProjectExport, VideoProject } from "@/types/project";
import { clipDisplayName, formatClipDuration } from "@/utils/exportFormat";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

function hasEffects(config: EditConfig): boolean {
  return (
    config.defaultEdit !== null ||
    config.custom.transitions.length > 0 ||
    config.custom.freezes.length > 0 ||
    config.custom.blurs.length > 0
  );
}

export default function EditorScreen() {
  // clipId (optional): edit a trimmed clip instead of the original video.
  const { id, clipId } = useLocalSearchParams<{
    id: string;
    clipId?: string;
  }>();
  const router = useRouter();

  const [project, setProject] = useState<VideoProject | null>(null);
  const [clip, setClip] = useState<ProjectExport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isScrollEnabled, setIsScrollEnabled] = useState(true);

  // Non-destructive edit settings (original video only, not clips).
  const [editConfig, setEditConfig] = useState<EditConfig | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Stop vertical scrolling while a trim handle or the playhead is dragged.
  const handleDraggingChange = useCallback((isDragging: boolean) => {
    setIsScrollEnabled(!isDragging);
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadProject = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [savedProject, savedClip, savedEdit] = await Promise.all([
          getProjectById(id),
          clipId ? getProjectExportById(clipId) : Promise.resolve(null),
          clipId ? Promise.resolve(null) : getProjectEdit(id),
        ]);

        if (!savedProject) {
          throw new Error("Project not found.");
        }

        if (clipId && !savedClip) {
          throw new Error("Clip not found.");
        }

        if (isActive) {
          setProject(savedProject);
          setClip(savedClip);
          setEditConfig(savedEdit);
        }
      } catch (err) {
        console.error("Failed to load project:", err);

        if (isActive) {
          setError(
            clipId
              ? "Could not load this clip. It may have been deleted."
              : "Could not load this project.",
          );
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
  }, [id, clipId]);

  // Save first, then update the screen, so the UI never shows an unsaved edit.
  const updateEdit = async (makeNext: (base: EditConfig) => EditConfig) => {
    if (!project || isSavingEdit || !videoDuration) return;

    try {
      setIsSavingEdit(true);

      const base = editConfig
        ? { ...editConfig, sourceDuration: videoDuration }
        : createEmptyEditConfig(project.originalUri, videoDuration);
      const next = makeNext(base);

      await saveProjectEdit(project.id, next);
      setEditConfig(next);
    } catch (err) {
      console.error("Failed to save edit:", err);
      Alert.alert("Could not save", "Your edit was not changed. Please try again.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleApplyDefault = (regenerate: boolean) =>
    void updateEdit((base) => applyDefaultEdit(base, { regenerate }));

  const handleUnapplyDefault = () =>
    void updateEdit((base) => unapplyDefaultEdit(base));

  // What the live preview should show (approximate; export is exact).
  const effectsPreview = useMemo(() => {
    if (clip || !editConfig) return null;

    const timeline = buildTimeline(editConfig);
    return {
      freezes: resolveFreezes(editConfig),
      transitions: timeline.cuts.flatMap((cut) =>
        cut.transition
          ? [{ sourceTime: cut.sourceTime, duration: cut.transition.duration }]
          : [],
      ),
    };
  }, [clip, editConfig]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>

        <Text style={styles.headerTitle} numberOfLines={1}>
          {clip
            ? clipDisplayName(clip, "Edit Clip")
            : (project?.name ?? "Video Editor")}
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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          scrollEnabled={isScrollEnabled}
        >
          {/* key resets the player when switching between original and clip */}
          <VideoPreview
            key={clip?.uri ?? project.originalUri}
            uri={clip?.uri ?? project.originalUri}
            projectId={project.id}
            onDraggingChange={handleDraggingChange}
            onDurationLoaded={setVideoDuration}
            effectsPreview={effectsPreview}
          />

          {!clip && (
            <DefaultEditPanel
              config={editConfig}
              isReady={videoDuration > 0}
              isBusy={isSavingEdit}
              onApply={handleApplyDefault}
              onUnapply={handleUnapplyDefault}
            />
          )}

          {/* Only when there is something to render beyond a plain copy. */}
          {!clip && editConfig && hasEffects(editConfig) && (
            <RenderEditCard projectId={project.id} config={editConfig} />
          )}

          <View style={styles.info}>
            <Text style={styles.projectName}>{project.name}</Text>
            <Text style={styles.subtitle}>
              {clip
                ? `Editing a ${formatClipDuration(clip.duration)} trimmed clip. ` +
                  "New exports are saved to this project; the clip itself is unchanged."
                : "Your video is ready for editing."}
            </Text>
          </View>
        </ScrollView>
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
  scroll: {
    flex: 1,
  },
  content: {
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
