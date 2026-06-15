import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider } from "../ui/StoreProvider";
import { colors } from "../ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="review" options={{ title: "Review", presentation: "modal" }} />
          <Stack.Screen name="task/youtube" options={{ title: "Watch" }} />
          <Stack.Screen name="task/reading" options={{ title: "Read" }} />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
