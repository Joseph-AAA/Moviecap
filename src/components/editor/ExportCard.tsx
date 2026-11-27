import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";
import { exportTrimmedRange } from "@/services/render/exportTrim";
import {
  isRenderingAvailable,
  RenderCancelledError,
  renderProjectEdit,
  type RenderHandle,
} from "@/services/render/renderProject";
import { hasEditEffects } from "@/services/timeline/editTimeline";
import type { EditConfig } from "@/types/edit";
import { formatClipDuration } from "@/utils/exportFormat";

interface ExportCardProps {
  projectId: string;
  /** The video being edited (original or clip). */
  sourceUri: string;
  /** Edit settings with effects, or null (clips / nothing applied). */
  config: EditConfig | null;
  /** Current trim selection in seconds. */
  range: { start: number; end: number };
  videoDuration: number;
  onExported?: () => void;
  /** Called right before exporting (e.g. to pause the background preview). */
  onExportStart?: () => void;
  /** Called when exporting ends, whatever the result. */
  onExportEnd?: () => void;
}

const MIN_EXPORT_SECONDS = 0.5;
const WHOLE_VIDEO_TOLERANCE = 0.25;

/**
 * The ONE Export button. Always exports the trim selection as a new clip:
 * - with effects (cuts, transitions, freezes) when any are applied, via the
 *   FFmpeg renderer, with progress and Cancel;
 * - otherwise a quick trim.
 * The original video is never changed.
 */
export default function ExportCard({
  projectId,
  sourceUri,
  config,
  range,
  videoDuration,
  onExported,
  onExportStart,
  onExportEnd,
}: ExportCardProps) {
  const [progress, setProgress] = useState<number | null>(null);
  const [isTrimming, setIsTrimming] = useState(false);
  const renderRef = useRef<RenderHandle | null>(null);

  const withEffects = config !== null && hasEditEffects(config);
  const canRender = isRenderingAvailable();
  const isWhole =
    range.start <= WHOLE_VIDEO_TOLERANCE &&
    range.end >= videoDuration - WHOLE_VIDEO_TOLERANCE;
  const length = range.end - range.start;
  const isBusy = progress !== null || isTrimming;

  const rangeText = isWhole
    ? "whole video"
    : `${formatClipDuration(range.start)}–${formatClipDuration(range.end)}`;
  const summary = withEffects
    ? canRender
      ? `Export ${rangeText} · with effects`
      : `Export ${rangeText} · effects need the latest app build`
    : `Export ${rangeText} · no effects`;

  const done = () => {
    onExported?.();
    Alert.alert(
      "Export saved",
      "Find it under Trimmed Clips on the Projects page. Your original video is unchanged.",
    );
  };

  const exportQuick = async () => {
    try {
      setIsTrimming(true);
      await exportTrimmedRange(sourceUri, projectId, range.start, range.end);
      done();
    } catch (error) {
      console.error("Export failed:", error);
      Alert.alert("Export failed", error instanceof Error ? error.message : "Could not export your video.");
    } finally {
      setIsTrimming(false);
    }
  };

  const exportWithEffects = async () => {
    if (!config) return;
    setProgress(0);
    const handle = renderProjectEdit(projectId, config, setProgress, range);
    renderRef.current = handle;

    try {
      await handle.done;
      done();
    } catch (error) {
      if (!(error instanceof RenderCancelledError)) {
        console.error("Render failed:", error);
        Alert.alert(
          "Export failed",
          error instanceof Error ? error.message.slice(0, 300) : "Could not render the video.",
        );
      }
    } finally {
      renderRef.current = null;
      setProgress(null);
    }
  };

  const onExport = () => {
    if (isBusy) return;
    if (length < MIN_EXPORT_SECONDS) {
      Alert.alert("Selection too short", "Please select at least 0.5 seconds.");
      return;
    }
    if (withEffects && !canRender) {
      Alert.alert(
        "Effects can't be exported yet",
        "Install the latest app build to export effects. Export this part without effects instead?",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Export without effects", onPress: () => void exportQuick() },
        ],
      );
      return;
    }
    onExportStart?.();
    void (withEffects ? exportWithEffects() : exportQuick()).finally(() => onExportEnd?.());
  };

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
      <Text style={{ color: C.secondaryText, fontSize: 12 }}>
        {summary} · {formatClipDuration(length)}
      </Text>

      {progress !== null ? (
        <View style={{ gap: 8 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: C.elevated, overflow: "hidden" }}>
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
            <Pressable onPress={() => renderRef.current?.cancel()} hitSlop={8}>
              <Text style={{ color: C.danger, fontSize: 14, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
          </View>
          <Text style={{ color: C.secondaryText, fontSize: 11 }}>
            Keep MovieCap open while rendering.
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onExport}
          disabled={isBusy || length < MIN_EXPORT_SECONDS}
          style={{
            minHeight: 48,
            borderRadius: 10,
            backgroundColor: C.primary,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
            opacity: isBusy || length < MIN_EXPORT_SECONDS ? 0.6 : 1,
          }}
        >
          {isTrimming && <ActivityIndicator color="#fff" />}
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>
            {isTrimming ? "Exporting…" : "Export"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
