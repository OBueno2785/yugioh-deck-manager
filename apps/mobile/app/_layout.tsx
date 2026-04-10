import "../global.css";
import { Tabs } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, Text } from "react-native";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 60, // 1 hour
      retry: 2,
    },
  },
});

function TabIcon({ emoji, label, focused }: { emoji: string; label: string; focused: boolean }) {
  return (
    <View className="items-center gap-0.5">
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
      <Text className={focused ? "text-accent text-xs font-semibold" : "text-muted text-xs"}>
        {label}
      </Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <Tabs
          screenOptions={{
            headerStyle: { backgroundColor: "#1a1a24" },
            headerTintColor: "#c89b3c",
            headerTitleStyle: { fontWeight: "bold" },
            tabBarStyle: {
              backgroundColor: "#1a1a24",
              borderTopColor: "#2a2a3a",
            },
            tabBarShowLabel: false,
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: "Card Search",
              tabBarIcon: ({ focused }) => (
                <TabIcon emoji="🔍" label="Search" focused={focused} />
              ),
            }}
          />
          <Tabs.Screen
            name="deck-builder"
            options={{
              title: "Deck Builder",
              tabBarIcon: ({ focused }) => (
                <TabIcon emoji="🃏" label="Deck" focused={focused} />
              ),
            }}
          />
          <Tabs.Screen
            name="consistency"
            options={{
              title: "Consistency",
              tabBarIcon: ({ focused }) => (
                <TabIcon emoji="📊" label="Analysis" focused={focused} />
              ),
            }}
          />
        </Tabs>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
