import { useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";
import {
  isRenderingAvailable,
  RenderCancelledError,
  renderProjectEdit,
  type RenderHandle,
} from "@/services/render/renderProject";
import type { EditConfig } from "@/types/edit";

interface RenderEditCardProps {
  projectId: string;
  config: EditConfig;
}

/**
 * "Export Edited Video": renders the saved edit (cuts, transitions, freeze
 * zooms) to a new clip. Separate from "Export Trimmed Video", which is
 * unchanged.
 */
export default function RenderEditCard({ projectId, config }: RenderEditCardProps) {
  const [progress, setProgress] = useState<number | null>(null);
  const handleRef = useRef<RenderHandle | null>(null);
  const available = isRenderingAvailable();

  const start = async () => {
    if (handleRef.current) return;

    setProgress(0);
    const handle = renderProjectEdit(projectId, config, setProgress);
    handleRef.current = handle;

    try {
      await handle.done;
      Alert.alert(
        "Edited video saved",
        "Find it under Trimmed Clips on the Projects page. Your original video is unchanged.",
      );
    } catch (error) {
      if (!(error instanceof RenderCancelledError)) {
        console.error("Render failed:", error);
        Alert.alert(
          "Export failed",
          error instanceof Error ? error.message.slice(0, 300) : "Could not render the video.",
        );
      }
    } finally {
      handleRef.current = null;
      setProgress(null);
    }
  };

  const cancel = () => handleRef.current?.cancel();
  const isRendering = progress !== null;

  return (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: C.border,
        padding: 14,
        gap: 10,
      }}
    >
      <Text
        style={{
          color: C.secondaryText,
          fontSize: 12,
          fontWeight: "700",
          letterSpacing: 1,
        }}
      >
        EXPORT WITH EFFECTS
      </Text>

      {!available ? (
        <Text style={{ color: C.secondaryText, fontSize: 12 }}>
          This version of the app can preview effects but not export them yet.
          Install the latest development build to enable exporting.
        </Text>
      ) : isRendering ? (
        <View style={{ gap: 8 }}>
          <View
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: C.elevated,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: "100%",
                backgroundColor: C.primary,
              }}
            />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: C.text, fontSize: 13 }}>
              Rendering… {Math.round(progress * 100)}%
            </Text>

            <Pressable onPress={cancel} hitSlop={8}>
              <Text style={{ color: C.danger, fontSize: 14, fontWeight: "600" }}>
                Cancel
              </Text>
            </Pressable>
          </View>

          <Text style={{ color: C.secondaryText, fontSize: 11 }}>
            Keep MovieCap open while rendering.
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={() => void start()}
          style={{
            minHeight: 46,
            borderRadius: 10,
            backgroundColor: C.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
            Export Edited Video
          </Text>
        </Pressable>
      )}
    </View>
  );
}
