import { Pressable, Text, View } from "react-native";

import { homeStyles as styles } from "@/styles/home.styles";

export default function HomeHeader() {
  return (
    <View style={styles.header}>
      <View>
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <View style={styles.playIcon} />
          </View>

          <View>
            <Text style={styles.brand}>MovieCap</Text>
            <Text style={styles.tagline}>CREATE WITHOUT LIMITS</Text>
          </View>
        </View>
      </View>

      <View style={styles.headerActions}>
        <Pressable style={styles.actionButton}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </Pressable>

        <Pressable style={styles.profileButton}>
          <View style={styles.avatarHead} />
          <View style={styles.avatarBody} />
        </Pressable>
      </View>
    </View>
  );
}
