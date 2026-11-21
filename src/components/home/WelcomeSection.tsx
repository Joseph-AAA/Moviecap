import { Text, View } from "react-native";

import { homeStyles as styles } from "@/styles/home.styles";

export default function WelcomeSection() {
  return (
    <View style={styles.welcome}>
      <Text style={styles.welcomeTitle}>Bring your stories</Text>

      <Text style={styles.welcomeTitle}>
        to <Text style={styles.purpleText}>life.</Text>
      </Text>

      <Text style={styles.description}>
        Create, dub and edit videos with the power of AI.
      </Text>
    </View>
  );
}
