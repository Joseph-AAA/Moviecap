import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";

export default function ImportVideoScreen() {
  const router = useRouter();

  const [video, setVideo] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const pickVideo = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        "Permission required",
        "Please allow MovieCap to access your videos.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets.length > 0) {
      setVideo(result.assets[0]);
    }
  };

  const formatDuration = (milliseconds?: number | null) => {
    if (milliseconds == null) return "Unknown duration";

    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.background }}
      contentContainerStyle={{
        padding: 24,
        paddingTop: 60,
        paddingBottom: 40,
      }}
    >
      <Pressable
        onPress={() => router.back()}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 14,
          alignSelf: "flex-start",
          backgroundColor: C.card,
          borderRadius: 12,
        }}
      >
        <Text style={{ color: "#22C55E", fontSize: 18 }}>
          VIDEO PICKER TEST
        </Text>
      </Pressable>

      <Text
        style={{
          color: C.text,
          fontSize: 26,
          fontWeight: "700",
          marginTop: 35,
        }}
      >
        Import Video
      </Text>

      <Text
        style={{
          color: C.secondaryText,
          fontSize: 14,
          marginTop: 8,
          marginBottom: 28,
        }}
      >
        Choose a video to start creating your project.
      </Text>

      <View
        style={{
          backgroundColor: C.card,
          borderRadius: 20,
          padding: 24,
          alignItems: "center",
          borderWidth: 1,
          borderColor: C.border,
        }}
      >
        <Text style={{ fontSize: 42 }}>🎬</Text>

        <Text
          style={{
            color: C.text,
            fontSize: 18,
            fontWeight: "700",
            marginTop: 14,
          }}
        >
          Select a video
        </Text>

        <Text
          style={{
            color: C.secondaryText,
            textAlign: "center",
            marginTop: 8,
            lineHeight: 21,
          }}
        >
          Import a video from your device to begin editing.
        </Text>

        <Pressable
          onPress={pickVideo}
          style={{
            backgroundColor: C.primary,
            paddingVertical: 15,
            borderRadius: 12,
            width: "100%",
            alignItems: "center",
            marginTop: 24,
          }}
        >
          <Text
            style={{
              color: C.text,
              fontSize: 15,
              fontWeight: "700",
            }}
          >
            Choose from Gallery
          </Text>
        </Pressable>
      </View>

      <Text
        style={{
          color: C.text,
          fontSize: 17,
          fontWeight: "700",
          marginTop: 30,
          marginBottom: 14,
        }}
      >
        Selected Video
      </Text>

      {video ? (
        <View
          style={{
            backgroundColor: C.card,
            padding: 18,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: C.border,
          }}
        >
          <Text style={{ color: C.text, fontWeight: "600" }}>
            {video.fileName || "Selected video"}
          </Text>

          <Text style={{ color: C.secondaryText, marginTop: 8 }}>
            Duration: {formatDuration(video.duration)}
          </Text>

          <Text style={{ color: C.secondaryText, marginTop: 5 }}>
            Size:{" "}
            {video.fileSize
              ? `${(video.fileSize / (1024 * 1024)).toFixed(2)} MB`
              : "Unknown"}
          </Text>

          <Pressable onPress={pickVideo} style={{ marginTop: 18 }}>
            <Text style={{ color: C.primaryLight, fontWeight: "600" }}>
              Choose another video
            </Text>
          </Pressable>
        </View>
      ) : (
        <View
          style={{
            backgroundColor: C.card,
            padding: 28,
            borderRadius: 16,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 30 }}>📁</Text>

          <Text
            style={{
              color: C.text,
              fontWeight: "600",
              marginTop: 12,
            }}
          >
            No video selected
          </Text>

          <Text
            style={{
              color: C.secondaryText,
              fontSize: 13,
              marginTop: 6,
              textAlign: "center",
            }}
          >
            Your selected video details will appear here.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
