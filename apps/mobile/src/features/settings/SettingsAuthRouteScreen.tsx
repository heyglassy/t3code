import { useAuth } from "@clerk/expo";
import { AuthView, UserProfileView } from "@clerk/expo/native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import * as Effect from "effect/Effect";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import {
  clearDesktopRelayBrokerSession,
  configureDesktopRelayBroker,
  useDesktopRelayBrokerSession,
} from "../cloud/desktopRelayBroker";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { runtime } from "../../lib/runtime";
import { AppText as Text } from "../../components/AppText";

export function SettingsAuthRouteScreen() {
  const navigation = useNavigation();

  useEffect(() => {
    if (!hasCloudPublicConfig()) {
      navigation.dispatch(StackActions.replace("Settings"));
    }
  }, [navigation]);

  return hasCloudPublicConfig() ? <ConfiguredSettingsAuthRouteScreen /> : null;
}

function ConfiguredSettingsAuthRouteScreen() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const navigation = useNavigation();
  const brokerSession = useDesktopRelayBrokerSession();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const [isConnectingDesktop, setIsConnectingDesktop] = useState(false);
  const directDesktopConnections = useMemo(
    () => Object.values(savedConnectionsById).filter((connection) => connection.bearerToken),
    [savedConnectionsById],
  );

  const connectDesktop = useCallback(
    async (connection: (typeof directDesktopConnections)[number]) => {
      setIsConnectingDesktop(true);
      const result = await runtime.runPromiseExit(configureDesktopRelayBroker(connection));
      setIsConnectingDesktop(false);
      if (result._tag === "Failure") {
        Alert.alert(
          "Desktop sign-in unavailable",
          "Make sure GlassyCode Desktop is open, connected directly to this phone, and signed in to T3 Connect.",
        );
        return;
      }
      navigation.goBack();
    },
    [navigation],
  );

  const chooseDesktop = useCallback(() => {
    if (directDesktopConnections.length === 0) {
      Alert.alert(
        "Connect a desktop first",
        "Open Environments and scan the pairing code shown by GlassyCode Desktop, then return here.",
      );
      return;
    }
    if (directDesktopConnections.length === 1) {
      void connectDesktop(directDesktopConnections[0]);
      return;
    }
    Alert.alert("Choose a desktop", "Use the T3 Connect account signed in on this desktop.", [
      ...directDesktopConnections.slice(0, 4).map((connection) => ({
        text: connection.environmentLabel,
        onPress: () => void connectDesktop(connection),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [connectDesktop, directDesktopConnections]);

  const disconnectDesktop = useCallback(() => {
    Alert.alert(
      "Disconnect desktop sign-in?",
      "GlassyCode Mobile will stop using this desktop's T3 Connect account.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void runtime.runPromise(Effect.ignore(clearDesktopRelayBrokerSession())),
        },
      ],
    );
  }, []);

  return (
    <>
      <NativeStackScreenOptions
        options={{ title: isSignedIn || brokerSession ? "Account" : "Sign in" }}
      />
      <View collapsable={false} className="flex-1 overflow-hidden bg-sheet">
        {isLoaded ? (
          isSignedIn ? (
            <UserProfileView isDismissible={false} />
          ) : brokerSession ? (
            <View className="flex-1 justify-center gap-5 px-6">
              <View className="gap-2 rounded-[24px] bg-card p-5">
                <Text className="text-lg font-semibold text-foreground">
                  Connected through desktop
                </Text>
                <Text className="text-sm leading-normal text-foreground-muted">
                  GlassyCode Mobile uses the T3 Connect account on {brokerSession.environmentLabel}.
                  Tokens renew automatically while that desktop is open and signed in.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                className="items-center rounded-full bg-destructive px-5 py-3 active:opacity-70"
                onPress={disconnectDesktop}
              >
                <Text className="font-semibold text-destructive-foreground">Disconnect</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-1">
              <View className="gap-3 px-6 pb-4 pt-6">
                <Pressable
                  accessibilityRole="button"
                  disabled={isConnectingDesktop}
                  className="items-center rounded-full bg-primary px-5 py-3 active:opacity-70 disabled:opacity-50"
                  onPress={chooseDesktop}
                >
                  {isConnectingDesktop ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="font-semibold text-primary-foreground">
                      Use GlassyCode Desktop
                    </Text>
                  )}
                </Pressable>
                <Text className="text-center text-xs leading-normal text-foreground-muted">
                  Sign in once on your Mac, then let this phone renew through it automatically.
                </Text>
              </View>
              <View className="h-px bg-border" />
              <View className="flex-1">
                <AuthView isDismissible={false} />
              </View>
            </View>
          )
        ) : null}
      </View>
    </>
  );
}
