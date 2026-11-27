import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState, type ComponentRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  Text,
  View,
} from "react-native";

import ExportPlayerModal from "@/components/editor/ExportPlayerModal";
import ProjectMenu, { type MenuAnchor } from "@/components/projects/ProjectMenu";
import RenameProjectModal from "@/components/projects/RenameProjectModal";
import { MovieCapColors as C } from "@/constants/theme";
import { getRecentExports, updateProjectExportName } from "@/services/database";
import { removeProjectExport } from "@/services/project-storage";
import type { RecentExport } from "@/types/project";
import {
  clipDisplayName,
  formatClipDuration,
  formatExportDate,
} from "@/utils/exportFormat";

interface ClipListProps {
  /** Section heading, e.g. "RECENT CLIPS". */
  title: string;
  /** Max clips to show; omit to show all. */
  limit?: number;
  /** Show a ⋮ menu (Rename / Delete) on each clip. */
  allowManage?: boolean;
  /** Called after a clip is renamed or deleted (e.g. to refresh counts). */
  onChanged?: () => void;
  /** Style for the outer wrapper (spacing differs per screen). */
  style?: object;
  /** Style for the section title text, to match the host screen. */
  titleStyle?: object;
  /** Change this value to force a reload (e.g. after a project is deleted). */
  refreshKey?: unknown;
}

/**
 * Trimmed clips across all projects, newest first. Renders nothing until
 * at least one clip exists. Reloads whenever the screen regains focus.
 */
export default function ClipList({
  title,
  limit,
  allowManage = false,
  onChanged,
  style,
  titleStyle,
  refreshKey,
}: ClipListProps) {
  const router = useRouter();
  const [clips, setClips] = useState<RecentExport[]>([]);
  const [playing, setPlaying] = useState<RecentExport | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // One shared popup: which clip it's for and where its ⋮ button is.
  const [menu, setMenu] = useState<{ clip: RecentExport; anchor: MenuAnchor } | null>(null);
  const dotsRefs = useRef<Record<string, ComponentRef<typeof View> | null>>({});
  const openMenu = (clip: RecentExport) => {
    dotsRefs.current[clip.id]?.measureInWindow((x, y, width, height) =>
      setMenu({ clip, anchor: { x, y, width, height } }),
    );
  };
  const closeMenu = () => setMenu(null);
  const [renamingClip, setRenamingClip] = useState<RecentExport | null>(null);
  const [isSavingName, setIsSavingName] = useState(false);

  const reload = useCallback(async () => {
    try {
      setClips(await getRecentExports(limit));
    } catch (error) {
      console.error("Failed to load clips:", error);
    }
  }, [limit]);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      getRecentExports(limit)
        .then((rows) => {
          if (isActive) setClips(rows);
        })
        .catch((error) => console.error("Failed to load clips:", error));

      return () => {
        isActive = false;
        setMenu(null);
      };
      // refreshKey is intentionally a trigger-only dependency.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [limit, refreshKey]),
  );

  const handleRename = async (newName: string) => {
    if (!renamingClip || isSavingName) return;

    try {
      setIsSavingName(true);
      await updateProjectExportName(renamingClip.id, newName);
      await reload();
      onChanged?.();
      setRenamingClip(null);
    } catch (error) {
      console.error("Failed to rename clip:", error);
      Alert.alert("Rename failed", "Could not rename this clip.");
    } finally {
      setIsSavingName(false);
    }
  };

  const confirmDelete = (clip: RecentExport) => {
    Alert.alert(
      "Delete clip?",
      `"${clipDisplayName(clip, clip.projectName)}" will be removed. The original video is not affected.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingId(clip.id);
              await removeProjectExport(clip);
              await reload();
              onChanged?.();
            } catch (error) {
              console.error("Failed to delete clip:", error);
              Alert.alert("Delete failed", "Could not delete this clip.");
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  };

  if (clips.length === 0) return null;

  return (
    <View style={style}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Text style={titleStyle}>{title}</Text>
        <Text style={{ color: C.secondaryText, fontSize: 12 }}>
          {clips.length} {clips.length === 1 ? "clip" : "clips"}
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        {clips.map((clip) => {
          const isDeleting = deletingId === clip.id;
          const displayName = clipDisplayName(clip, clip.projectName);

          return (
            <View key={clip.id}>
              <Pressable
                // Card opens the clip in the editor; the thumbnail plays it.
                onPress={() => {
                  router.push({
                    pathname: "/editor/[id]",
                    params: { id: clip.projectId, clipId: clip.id },
                  });
                }}
                disabled={isDeleting}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: C.card,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: C.border,
                  padding: 12,
                  gap: 12,
                  opacity: isDeleting ? 0.5 : 1,
                }}
              >
                <Pressable
                  onPress={() => {
                    setPlaying(clip);
                  }}
                  hitSlop={4}
                  accessibilityLabel="Play clip"
                >
                  {clip.projectThumbnailUri ? (
                    <Image
                      source={{ uri: clip.projectThumbnailUri }}
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
                      }}
                    />
                  )}

                  {/* Play badge over the thumbnail */}
                  <View
                    style={{
                      position: "absolute",
                      inset: 0,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        backgroundColor: "rgba(139, 92, 246, 0.9)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: "#fff", fontSize: 11 }}>▶</Text>
                    </View>
                  </View>
                </Pressable>

                <View style={{ flex: 1, gap: 5 }}>
                  <Text
                    style={{ color: C.text, fontSize: 14, fontWeight: "700" }}
                    numberOfLines={1}
                  >
                    {displayName}
                  </Text>

                  <Text style={{ color: C.secondaryText, fontSize: 12 }}>
                    ✂ {formatClipDuration(clip.duration)} ·{" "}
                    {formatExportDate(clip.createdAt)}
                  </Text>

                  {/* Once renamed, still show which project it came from. */}
                  {clip.name ? (
                    <Text
                      style={{ color: C.secondaryText, fontSize: 12 }}
                      numberOfLines={1}
                    >
                      From {clip.projectName}
                    </Text>
                  ) : null}

                  <Text style={{ color: C.primaryLight, fontSize: 12 }}>
                    Tap to edit · ▶ to play
                  </Text>
                </View>

                {allowManage &&
                  (isDeleting ? (
                    <ActivityIndicator size="small" color={C.danger} />
                  ) : (
                    <Pressable
                      ref={(node) => {
                        dotsRefs.current[clip.id] = node;
                      }}
                      onPress={() => openMenu(clip)}
                      hitSlop={8}
                      accessibilityLabel="Clip options"
                      style={{
                        width: 32,
                        height: 40,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: C.secondaryText,
                          fontSize: 23,
                          fontWeight: "700",
                        }}
                      >
                        ⋮
                      </Text>
                    </Pressable>
                  ))}
              </Pressable>

            </View>
          );
        })}
      </View>

      {allowManage && (
        <ProjectMenu
          visible={menu !== null}
          anchor={menu?.anchor ?? null}
          onClose={closeMenu}
          onRename={() => {
            if (menu) setRenamingClip(menu.clip);
            closeMenu();
          }}
          onDelete={() => {
            if (menu) confirmDelete(menu.clip);
            closeMenu();
          }}
        />
      )}

      {playing && (
        <ExportPlayerModal
          uri={playing.uri}
          title={clipDisplayName(playing, playing.projectName)}
          onClose={() => setPlaying(null)}
        />
      )}

      {allowManage && (
        <RenameProjectModal
          visible={renamingClip !== null}
          currentName={
            renamingClip
              ? clipDisplayName(renamingClip, renamingClip.projectName)
              : null
          }
          isSaving={isSavingName}
          onClose={() => {
            if (!isSavingName) setRenamingClip(null);
          }}
          onSave={handleRename}
          title="Rename Clip"
          description="Enter a new name for this trimmed clip."
          placeholder="Clip name"
        />
      )}
    </View>
  );
}
