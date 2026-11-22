import AIDubbingCard from "@/components/home/AIDubbingCard";
import HomeHeader from "@/components/home/HomeHeader";
import NewProjectCard from "@/components/home/NewProjectCard";
import RecentProjects from "@/components/home/RecentProjects";
import WelcomeSection from "@/components/home/WelcomeSection";
import { homeStyles as styles } from "@/styles/home.styles";
import { ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {/* Header */}
        <HomeHeader />

        {/* Welcome */}
        <WelcomeSection />

        {/* New Project */}
        <NewProjectCard />

        {/* AI Dubbing */}
        <AIDubbingCard />

        {/* Recent Projects */}
        <RecentProjects />
      </ScrollView>
    </SafeAreaView>
  );
}
