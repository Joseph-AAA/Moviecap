import { MovieCapColors as C } from "@/constants/theme";
import { NativeTabs } from "expo-router/native-tabs";

export default function AppTabs() {
  return (
    <NativeTabs
      backgroundColor={C.background}
      indicatorColor={C.elevated}
      labelStyle={{ selected: { color: C.text } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require("@/assets/images/tabIcons/home.png")}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="projects">
        <NativeTabs.Trigger.Label>Projects</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require("@/assets/images/tabIcons/explore.png")}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

// import { MovieCapColors as C } from "@/constants/theme";
// import { Tabs } from "expo-router";

// export default function AppTabs() {
//   return (
//     <Tabs
//       screenOptions={{
//         headerShown: false,
//         tabBarStyle: {
//           backgroundColor: C.background,
//           borderTopColor: C.border,
//         },
//         tabBarActiveTintColor: C.text,
//         tabBarInactiveTintColor: C.secondaryText,
//       }}
//     >
//       <Tabs.Screen name="index" options={{ title: "Home" }} />

//       <Tabs.Screen name="projects" options={{ title: "Projects" }} />
//     </Tabs>
//   );
// }
