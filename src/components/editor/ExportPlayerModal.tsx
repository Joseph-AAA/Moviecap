import { File } from "expo-file-system";
import { useVideoPlayer, VideoView } from "expo-video";
import { useMemo } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MovieCapColors as C } from "@/constants/theme";

interface ExportPlayerModalProps {
  uri: string;
  title: string;
  onClose: () => void;
}

/**
 * Full-screen player for one exported clip.
 * Mount it only while a clip is selected so each clip gets a fresh player.
 */
export default function ExportPlayerModal({
  uri,
  title,
  onClose,
}: ExportPlayerModalProps) {
  // contentUri is required on Android (same fix as the editor preview).
  const videoUri = useMemo(() => new File(uri).contentUri, [uri]);

  const player = useVideoPlayer(videoUri, (instance) => {
    instance.play();
  });

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={8}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>

        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls
          allowsPictureInPicture={false}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  title: {
    flex: 1,
    color: C.text,
    fontSize: 16,
    fontWeight: "700",
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.elevated,
  },
  closeText: {
    color: C.text,
    fontSize: 14,
    fontWeight: "600",
  },
  video: {
    flex: 1,
  },
});
