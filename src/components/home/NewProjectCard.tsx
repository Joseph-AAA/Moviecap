import { Pressable, Text, View } from "react-native";

import { homeStyles as styles } from "@/styles/home.styles";

export default function NewProjectCard() {
  return (
    <Pressable style={styles.newProject}>
      <View style={styles.newProjectIcon}>
        <Text style={styles.plus}>＋</Text>
      </View>

      <View style={styles.newProjectText}>
        <Text style={styles.newProjectTitle}>New Project</Text>
        <Text style={styles.newProjectSubtitle}>
          Start creating something amazing
        </Text>
      </View>

      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}
