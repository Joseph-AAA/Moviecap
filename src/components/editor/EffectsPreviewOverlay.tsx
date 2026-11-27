import { useEventListener } from "expo";
import { Image } from "expo-image";
import type { VideoPlayer, VideoThumbnail } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

import type { FreezeEffect } from "@/types/edit";

export interface PreviewTransition {
  sourceTime: number;
  duration: number;
}

interface EffectsPreviewOverlayProps {
  player: VideoPlayer;
  freezes: FreezeEffect[];
  transitions: PreviewTransition[];
}

/** Only react to normal playback, not to seeks or scrubbing. */
const MAX_PLAYBACK_STEP = 0.6;

/**
 * Approximate, live preview of timeline effects on top of the editor's
 * player. Nothing here affects the source video or the export:
 * - Freeze: when playback crosses a freeze time, the player pauses and the
 *   real frame at that time is shown with a slow zoom for the freeze
 *   duration, then playback resumes.
 * - Transition: a brief dip at each cut, approximating the dissolve.
 */
export default function EffectsPreviewOverlay({
  player,
  freezes,
  transitions,
}: EffectsPreviewOverlayProps) {
  const [frames, setFrames] = useState<Record<string, VideoThumbnail>>({});
  const [activeFreeze, setActiveFreeze] = useState<FreezeEffect | null>(null);

  // Stable animated values, created once.
  const [scale] = useState(() => new Animated.Value(1));
  const [dip] = useState(() => new Animated.Value(0));
  const lastTimeRef = useRef(0);
  const freezeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFreezeRef = useRef<FreezeEffect | null>(null);
  const resumingRef = useRef(false);

  // Pre-capture the real frames for each freeze (sharp, aspect preserved).
  const freezeKey = freezes.map((f) => `${f.id}@${f.sourceTime}`).join("|");
  useEffect(() => {
    // Frames are keyed by freeze id, so stale ones are simply never used.
    if (freezes.length === 0) return;

    let isActive = true;

    player
      .generateThumbnailsAsync(
        freezes.map((f) => f.sourceTime),
        { maxWidth: 1080 },
      )
      .then((thumbs) => {
        if (!isActive) return;
        const next: Record<string, VideoThumbnail> = {};
        freezes.forEach((f, i) => {
          if (thumbs[i]) next[f.id] = thumbs[i];
        });
        setFrames(next);
      })
      .catch((error) => console.warn("Freeze preview frames failed:", error));

    return () => {
      isActive = false;
    };
    // freezeKey captures the meaningful freeze changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freezeKey, player]);

  const endFreeze = (resume: boolean) => {
    if (freezeTimerRef.current) clearTimeout(freezeTimerRef.current);
    freezeTimerRef.current = null;
    scale.stopAnimation();
    activeFreezeRef.current = null;
    setActiveFreeze(null);

    if (resume) {
      resumingRef.current = true;
      player.play();
    }
  };

  // Clean up timers if the editor closes mid-freeze.
  useEffect(
    () => () => {
      if (freezeTimerRef.current) clearTimeout(freezeTimerRef.current);
    },
    [],
  );

  const startFreeze = (freeze: FreezeEffect) => {
    if (!frames[freeze.id]) return; // frame not ready: skip silently

    player.pause();
    activeFreezeRef.current = freeze;
    setActiveFreeze(freeze);

    scale.setValue(freeze.zoomFrom);
    Animated.timing(scale, {
      toValue: freeze.zoomTo,
      duration: freeze.duration * 1000,
      easing: Easing.inOut(Easing.quad), // gradual, cinematic
      useNativeDriver: true,
    }).start();

    freezeTimerRef.current = setTimeout(
      () => endFreeze(true),
      freeze.duration * 1000,
    );
  };

  const playDip = (duration: number) => {
    dip.setValue(0);
    Animated.sequence([
      Animated.timing(dip, {
        toValue: 0.55,
        duration: (duration * 1000) / 2,
        useNativeDriver: true,
      }),
      Animated.timing(dip, {
        toValue: 0,
        duration: (duration * 1000) / 2,
        useNativeDriver: true,
      }),
    ]).start();
  };

  useEventListener(player, "timeUpdate", ({ currentTime }) => {
    const previous = lastTimeRef.current;
    lastTimeRef.current = currentTime;

    if (activeFreezeRef.current) return;

    const step = currentTime - previous;
    if (step <= 0 || step > MAX_PLAYBACK_STEP || !player.playing) return;

    const crossed = (t: number) => previous < t && currentTime >= t;

    const freeze = freezes.find((f) => crossed(f.sourceTime));
    if (freeze) {
      startFreeze(freeze);
      return;
    }

    const transition = transitions.find((t) => crossed(t.sourceTime));
    if (transition) playDip(transition.duration);
  });

  // If the user presses play/pause during a freeze, hand control back.
  useEventListener(player, "playingChange", ({ isPlaying }) => {
    if (resumingRef.current) {
      resumingRef.current = false;
      return;
    }
    if (activeFreezeRef.current && isPlaying) endFreeze(false);
  });

  const frame = activeFreeze ? frames[activeFreeze.id] : null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: dip }]}
      />

      {activeFreeze && frame && (
        <View style={[StyleSheet.absoluteFill, styles.freezeContainer]}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}>
            <Image
              source={frame}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
            />
          </Animated.View>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>❄ Freeze preview</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  freezeContainer: {
    backgroundColor: "#000",
    overflow: "hidden",
  },
  badge: {
    position: "absolute",
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
});
