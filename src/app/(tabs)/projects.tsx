import { projectsStyles as styles } from "@/styles/projects.styles";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function ProjectsScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>My Projects</Text>
            <Text style={styles.subtitle}>
              All your creative work in one place.
            </Text>
          </View>

          <View style={styles.countBadge}>
            <Text style={styles.countText}>0</Text>
          </View>
        </View>

        {/* New Project Card */}
        <Pressable
          style={styles.newProjectCard}
          onPress={() => router.push("/import-video")}
        >
          <View style={styles.plusIcon}>
            <Text style={styles.plusText}>+</Text>
          </View>

          <View style={styles.newProjectInfo}>
            <Text style={styles.newProjectTitle}>Create New Project</Text>
            <Text style={styles.newProjectDescription}>
              Start editing a new video
            </Text>
          </View>

          <Text style={styles.arrow}>›</Text>
        </Pressable>

        {/* Project Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>YOUR WORK</Text>
          <Text style={styles.sortText}>Recently edited</Text>
        </View>

        {/* Empty State */}
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Text style={styles.folderIcon}>▱</Text>
          </View>

          <Text style={styles.emptyTitle}>No projects yet</Text>

          <Text style={styles.emptyDescription}>
            Your video projects will appear here. Start creating your first
            project and bring your stories to life.
          </Text>
        </View>

        {/* Storage Information */}
        <View style={styles.storageCard}>
          <Text style={styles.storageTitle}>LOCAL STORAGE</Text>
          <Text style={styles.storageDescription}>
            Your projects are stored on your device.
          </Text>
          <Text style={styles.storageStatus}>0 projects created</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
