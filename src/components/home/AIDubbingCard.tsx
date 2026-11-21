import { Pressable, Text, View } from "react-native";

import { homeStyles as styles } from "@/styles/home.styles";

export default function AIDubbingCard() {
  return (
    <Pressable style={styles.dubbingCard}>
      <View style={styles.dubbingIcon}>
        <Text style={styles.toolEmoji}>🎙</Text>
      </View>

      <View style={styles.dubbingInfo}>
        <Text style={styles.dubbingTitle}>AI Video Dubbing</Text>

        <Text style={styles.dubbingDescription}>
          Translate and dub videos into Burmese.
        </Text>

        <View style={styles.badge}>
          <Text style={styles.badgeText}>OFFLINE AI</Text>
        </View>
      </View>

      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}
