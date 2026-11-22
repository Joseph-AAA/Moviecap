import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { View } from "react-native";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <ThemeProvider
      value={{
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: "#101014",
          card: "#101014",
        },
      }}
    >
      <AnimatedSplashOverlay />
      <View style={{ flex: 1, backgroundColor: "#101014" }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: "#101014",
            },
            animation: "ios_from_right",
          }}
        >
          <Stack.Screen name="(tabs)" />

          <Stack.Screen
            name="import-video"
            options={{
              presentation: "card",
              animation: "ios_from_right",
            }}
          />
        </Stack>
      </View>
    </ThemeProvider>
  );
}
