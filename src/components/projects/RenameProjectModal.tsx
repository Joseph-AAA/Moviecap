import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";
import type { VideoProject } from "@/types/project";

interface RenameProjectModalProps {
  visible: boolean;
  project: VideoProject | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (newName: string) => void;
}

export default function RenameProjectModal({
  visible,
  project,
  isSaving,
  onClose,
  onSave,
}: RenameProjectModalProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (visible && project) {
      setName(project.name);
    }
  }, [visible, project]);

  const handleSave = () => {
    const trimmedName = name.trim();

    if (!trimmedName || isSaving) return;

    onSave(trimmedName);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.65)",
          justifyContent: "center",
          paddingHorizontal: 24,
        }}
      >
        <View
          style={{
            backgroundColor: C.card,
            borderRadius: 18,
            padding: 22,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text
            style={{
              color: C.text,
              fontSize: 19,
              fontWeight: "700",
              marginBottom: 8,
            }}
          >
            Rename Project
          </Text>

          <Text
            style={{
              color: C.secondaryText,
              fontSize: 13,
              marginBottom: 18,
            }}
          >
            Enter a new name for your project.
          </Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Project name"
            placeholderTextColor={C.secondaryText}
            editable={!isSaving}
            maxLength={80}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={handleSave}
            style={{
              backgroundColor: C.background,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: C.text,
              fontSize: 15,
              marginBottom: 20,
            }}
          />

          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              gap: 12,
            }}
          >
            <Pressable
              onPress={onClose}
              disabled={isSaving}
              style={{
                backgroundColor: C.elevated,
                paddingHorizontal: 18,
                paddingVertical: 11,
                borderRadius: 10,
              }}
            >
              <Text style={{ color: C.text, fontWeight: "600" }}>Cancel</Text>
            </Pressable>

            <Pressable
              onPress={handleSave}
              disabled={!name.trim() || isSaving}
              style={{
                backgroundColor: C.primary,
                opacity: !name.trim() || isSaving ? 0.5 : 1,
                paddingHorizontal: 18,
                paddingVertical: 11,
                borderRadius: 10,
              }}
            >
              <Text style={{ color: C.text, fontWeight: "700" }}>
                {isSaving ? "Saving..." : "Save"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
