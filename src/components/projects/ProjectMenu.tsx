import { MovieCapColors as C } from "@/constants/theme";
import { Pressable, Text, View } from "react-native";

interface ProjectMenuProps {
  visible: boolean;
  onRename: () => void;
  onDelete: () => void;
}

export default function ProjectMenu({
  visible,
  onRename,
  onDelete,
}: ProjectMenuProps) {
  if (!visible) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 42,
        right: 0,
        width: 150,
        backgroundColor: C.card,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 12,
        paddingVertical: 6,
        zIndex: 100,
        elevation: 8,
      }}
    >
      <Pressable
        onPress={onRename}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 14,
        }}
      >
        <Text style={{ color: C.text, fontSize: 14 }}>Rename</Text>
      </Pressable>

      <View
        style={{
          height: 1,
          backgroundColor: C.border,
        }}
      />

      <Pressable
        onPress={onDelete}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 14,
        }}
      >
        <Text style={{ color: "#EF4444", fontSize: 14 }}>Delete</Text>
      </Pressable>
    </View>
  );
}
