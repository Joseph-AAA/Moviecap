import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";
import { buildTimeline } from "@/services/timeline/editTimeline";
import type { EditConfig } from "@/types/edit";
import { formatClipDuration } from "@/utils/exportFormat";

interface DefaultEditPanelProps {
  config: EditConfig | null;
  /** False until the video's real duration is known. */
  isReady: boolean;
  isBusy: boolean;
  onApply: (regenerate: boolean) => void;
  onUnapply: () => void;
}

function formatTimestamp(seconds: number) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Apply / Unapply Default card for the Edit page. It only shows and requests
 * changes; the screen owns saving (so the database stays the single source
 * of truth).
 */
export default function DefaultEditPanel({
  config,
  isReady,
  isBusy,
  onApply,
  onUnapply,
}: DefaultEditPanelProps) {
  const defaultEdit = config?.defaultEdit ?? null;
  const isApplied = defaultEdit !== null;

  const handleApplyPress = () => {
    if (!isApplied) {
      onApply(false);
      return;
    }

    // Already applied: never stack a second set of default effects.
    Alert.alert(
      "Default Edit is already applied",
      "Do you want new random cuts and freeze frames, or keep the current version?",
      [
        { text: "Keep current", style: "cancel" },
        { text: "Regenerate", onPress: () => onApply(true) },
      ],
    );
  };

  const handleUnapplyPress = () => {
    Alert.alert(
      "Unapply Default Edit?",
      "Removes the automatic cuts, transitions and freeze frames. Your own effects, blur and the original video are kept.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Unapply", style: "destructive", onPress: onUnapply },
      ],
    );
  };

  const timeline = config && isApplied ? buildTimeline(config) : null;

  return (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: C.border,
        padding: 14,
        gap: 12,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
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
          DEFAULT EDIT
        </Text>

        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
            backgroundColor: isApplied ? "rgba(34,197,94,0.15)" : C.elevated,
          }}
        >
          <Text
            style={{
              color: isApplied ? C.success : C.secondaryText,
              fontSize: 11,
              fontWeight: "700",
            }}
          >
            {isApplied ? "APPLIED" : "OFF"}
          </Text>
        </View>
      </View>

      <Text style={{ color: C.secondaryText, fontSize: 12 }}>
        Random 15–20 s cuts · subtle 0.4 s dissolves · 2–3 freeze frames with a
        slow 5 s zoom
      </Text>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable
          onPress={handleApplyPress}
          disabled={!isReady || isBusy}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 10,
            backgroundColor: C.primary,
            alignItems: "center",
            justifyContent: "center",
            opacity: !isReady || isBusy ? 0.5 : 1,
          }}
        >
          {isBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>
              {isApplied ? "Regenerate" : "Apply Default"}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={handleUnapplyPress}
          disabled={!isApplied || isBusy}
          style={{
            flex: 1,
            minHeight: 44,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: C.border,
            backgroundColor: C.elevated,
            alignItems: "center",
            justifyContent: "center",
            opacity: !isApplied || isBusy ? 0.4 : 1,
          }}
        >
          <Text style={{ color: C.text, fontSize: 14, fontWeight: "600" }}>
            Unapply Default
          </Text>
        </Pressable>
      </View>

      {defaultEdit && timeline && config && (
        <View style={{ gap: 10 }}>
          {/* Segment strip: widths proportional to each segment's length. */}
          <View
            style={{
              flexDirection: "row",
              height: 34,
              borderRadius: 8,
              overflow: "hidden",
              gap: 2,
            }}
          >
            {defaultEdit.segments.map((segment, index) => (
              <View
                key={segment.id}
                style={{
                  flex: segment.end - segment.start,
                  backgroundColor: index % 2 === 0 ? C.elevated : "#2F2B3D",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{ color: C.text, fontSize: 10, fontWeight: "600" }}
                >
                  {Math.round(segment.end - segment.start)}s
                </Text>
              </View>
            ))}
          </View>

          <Text style={{ color: C.secondaryText, fontSize: 12 }}>
            {defaultEdit.segments.length} segments ·{" "}
            {defaultEdit.transitions.length} transitions · final length{" "}
            {formatClipDuration(timeline.outputDuration)} (original{" "}
            {formatClipDuration(config.sourceDuration)})
          </Text>

          {defaultEdit.freezes.map((freeze) => (
            <Text key={freeze.id} style={{ color: C.primaryLight, fontSize: 12 }}>
              ❄ Freeze at {formatTimestamp(freeze.sourceTime)} · {freeze.duration}s
              · zoom to {freeze.zoomTo}×
            </Text>
          ))}

          <Text style={{ color: C.secondaryText, fontSize: 11 }}>
            Press play to preview. The preview is approximate; the exported
            video is rendered exactly.
          </Text>
        </View>
      )}
    </View>
  );
}
