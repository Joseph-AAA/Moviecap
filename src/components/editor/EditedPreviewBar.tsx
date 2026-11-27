import { Pressable, Text, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";

export type EditedPreviewStatus = "rendering" | "ready" | "error";

interface EditedPreviewBarProps {
  status: EditedPreviewStatus;
  progress: number;
  showEdited: boolean;
  onShowEditedChange: (showEdited: boolean) => void;
}

/**
 * Under the Edit page player: progress while the edited preview renders,
 * then an Edited / Original switch.
 */
export default function EditedPreviewBar({
  status,
  progress,
  showEdited,
  onShowEditedChange,
}: EditedPreviewBarProps) {
  if (status === "rendering") {
    return (
      <View style={{ gap: 6 }}>
        <Text style={{ color: C.secondaryText, fontSize: 12 }}>
          Applying effects to the preview… {Math.round(progress * 100)}% · showing
          the original until it’s ready
        </Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.elevated, overflow: "hidden" }}>
          <View
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: "100%",
              backgroundColor: C.primary,
            }}
          />
        </View>
      </View>
    );
  }

  if (status === "error") {
    return (
      <Text style={{ color: C.secondaryText, fontSize: 12 }}>
        The effects preview couldn’t be made. Export still works.
      </Text>
    );
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignSelf: "flex-start",
        backgroundColor: C.elevated,
        borderRadius: 10,
        padding: 3,
      }}
    >
      {[
        { value: true, label: "✨ Edited" },
        { value: false, label: "Original" },
      ].map((option) => {
        const selected = showEdited === option.value;
        return (
          <Pressable
            key={option.label}
            onPress={() => onShowEditedChange(option.value)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 8,
              backgroundColor: selected ? C.primary : "transparent",
            }}
          >
            <Text style={{ color: selected ? "#fff" : C.secondaryText, fontSize: 13, fontWeight: "600" }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
