import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";
import type { VideoProject } from "@/types/project";
import ProjectMenu from "./ProjectMenu";

interface ProjectCardProps {
  project: VideoProject;
  onPress: () => void;
  onRename: (project: VideoProject) => void;
  onDelete: (project: VideoProject) => void;
}

export default function ProjectCard({
  project,
  onPress,
  onRename,
  onDelete,
}: ProjectCardProps) {
  const [menuVisible, setMenuVisible] = useState(false);

  const formatDuration = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  const formatFileSize = (bytes: number) => {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleRename = () => {
    setMenuVisible(false);
    onRename(project);
  };

  const handleDelete = () => {
    setMenuVisible(false);
    onDelete(project);
  };

  return (
    <View
      style={{
        position: "relative",
        zIndex: menuVisible ? 10 : 0,
      }}
    >
      <Pressable
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
        onPress={onPress}
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
            {project.exportCount
              ? `✂ ${project.exportCount} trimmed ${
                  project.exportCount === 1 ? "clip" : "clips"
                }`
              : "Saved locally"}
          </Text>
        </View>

        <Pressable
          onPress={() => setMenuVisible((visible) => !visible)}
          hitSlop={8}
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
      </Pressable>

      <ProjectMenu
        visible={menuVisible}
        onRename={handleRename}
        onDelete={handleDelete}
      />
    </View>
  );
}
