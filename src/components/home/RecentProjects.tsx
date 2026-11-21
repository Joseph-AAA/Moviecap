import { Pressable, Text, View } from "react-native";

import { homeStyles as styles } from "@/styles/home.styles";

export default function RecentProjects() {
  return (
    <View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>RECENT PROJECTS</Text>

        <Pressable>
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      </View>

      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>🎬</Text>

        <Text style={styles.emptyTitle}>No projects yet</Text>

        <Text style={styles.emptyDescription}>
          Your video projects will appear here. Start your first project today!
        </Text>
      </View>
    </View>
  );
}
