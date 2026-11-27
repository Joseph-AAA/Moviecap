import { addProjectExport } from "@/services/database";
import { saveTrimmedVideo } from "@/services/videoStorage";
import { trim } from "react-native-video-trim";

import { useEvent, useEventListener } from "expo";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView, type VideoThumbnail } from "expo-video";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import EffectsPreviewOverlay, {
  type PreviewTransition,
} from "@/components/editor/EffectsPreviewOverlay";
import { MovieCapColors as C } from "@/constants/theme";
import type { FreezeEffect } from "@/types/edit";

interface VideoPreviewProps {
  uri: string;
  projectId: string;
  /** Called after a trimmed clip has been saved and recorded. */
  onExported?: () => void;
  /** Lets a parent ScrollView disable scrolling while a handle is dragged. */
  onDraggingChange?: (isDragging: boolean) => void;
  /** Reports the real video duration (seconds) once the source loads. */
  onDurationLoaded?: (duration: number) => void;
  /** Reports the playhead position (seconds) as it changes. */
  onPlayheadChange?: (time: number) => void;
  /** Jump to `time` and play; a new `key` triggers a new seek. */
  seekRequest?: { time: number; key: number } | null;
  /** Approximate live preview of timeline effects; null/undefined = none. */
  effectsPreview?: {
    freezes: FreezeEffect[];
    transitions: PreviewTransition[];
  } | null;
}

const MIN_TRIM_DURATION = 0.5;
const HANDLE_TOUCH_WIDTH = 44;
const PLAYHEAD_TOUCH_WIDTH = 40;

export default function VideoPreview({
  uri,
  projectId,
  onExported,
  onDraggingChange,
  onDurationLoaded,
  onPlayheadChange,
  seekRequest,
  effectsPreview,
}: VideoPreviewProps) {
  const [isExporting, setIsExporting] = useState(false);
  const videoUri = useMemo(() => new File(uri).contentUri, [uri]);
  const player = useVideoPlayer(videoUri);

  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [barWidth, setBarWidth] = useState(0);

  const [timelineFrames, setTimelineFrames] = useState<VideoThumbnail[]>([]);
  const [isGeneratingFrames, setIsGeneratingFrames] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);

  const trimStartRef = useRef(0);
  const trimEndRef = useRef(0);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const timelineWidthRef = useRef(0);
  const wasPlayingRef = useRef(false);
  const leftDragStartTimeRef = useRef(0);
  const rightDragStartTimeRef = useRef(0);
  const playheadDragStartTimeRef = useRef(0);

  const handleExport = async () => {
    if (isExporting) return;

    const selectedDuration = trimEnd - trimStart;

    if (selectedDuration < MIN_TRIM_DURATION) {
      Alert.alert("Invalid selection", "Please select at least 0.5 seconds.");
      return;
    }

    try {
      setIsExporting(true);
      player.pause();

      const result = await trim(uri, {
        startTime: Math.round(trimStart * 1000),
        endTime: Math.round(trimEnd * 1000),
        type: "video",
        outputExt: "mp4",
        saveToPhoto: false,
        removeAfterSavedToPhoto: false,
        removeAfterFailedToSavePhoto: false,
        enablePreciseTrimming: true,
        removeAudio: false,
        speed: 1.0,
      });

      if (!result.success || !result.outputPath) {
        throw new Error("The video trimming operation failed.");
      }

      const savedFile = await saveTrimmedVideo(result.outputPath, projectId);

      // Records the export in project_exports and updates projects.exportedUri.
      await addProjectExport(projectId, savedFile.uri, result.duration / 1000);
      onExported?.();

      Alert.alert(
        "Export successful",
        "Find it under Trimmed Clips on the Projects page.",
      );
    } catch (error) {
      console.error("Video export failed:", error);

      Alert.alert(
        "Export failed",
        error instanceof Error ? error.message : "Could not export your video.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    onDraggingChange?.(isDragging);
  }, [isDragging, onDraggingChange]);

  useEffect(() => {
    onPlayheadChange?.(currentTime);
  }, [currentTime, onPlayheadChange]);

  // Parent-requested seek (e.g. "Watch this cut"): jump there and play.
  useEffect(() => {
    if (!seekRequest) return;
    setPlayheadTime(seekRequest.time);
    player.play();
    // Only a new request key should trigger a seek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.key]);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.1;

    return () => {
      player.pause();
    };
  }, [player]);

  const setPlayheadTime = (time: number) => {
    const safeTime = Math.max(
      trimStartRef.current,
      Math.min(time, trimEndRef.current || durationRef.current),
    );

    currentTimeRef.current = safeTime;
    setCurrentTime(safeTime);
    player.currentTime = safeTime;
  };

  const pauseForDrag = () => {
    wasPlayingRef.current = player.playing;
    player.pause();
    setIsDragging(true);
  };

  const finishDrag = () => {
    setIsDragging(false);

    if (wasPlayingRef.current) {
      if (currentTimeRef.current >= trimEndRef.current) {
        setPlayheadTime(trimStartRef.current);
      }
      player.play();
    }
  };

  useEventListener(player, "timeUpdate", ({ currentTime: time }) => {
    if (isDragging) return;

    if (time < trimStartRef.current) {
      setPlayheadTime(trimStartRef.current);
      return;
    }

    if (trimEndRef.current > 0 && time >= trimEndRef.current) {
      currentTimeRef.current = trimEndRef.current;
      setCurrentTime(trimEndRef.current);
      player.pause();
      player.currentTime = trimEndRef.current;
      return;
    }

    currentTimeRef.current = time;
    setCurrentTime(time);
  });

  useEventListener(player, "sourceLoad", ({ duration: videoDuration }) => {
    durationRef.current = videoDuration;
    trimStartRef.current = 0;
    trimEndRef.current = videoDuration;

    setDuration(videoDuration);
    onDurationLoaded?.(videoDuration);
    setTrimStart(0);
    setTrimEnd(videoDuration);
    currentTimeRef.current = 0;
    setCurrentTime(0);
  });

  // Generate timeline thumbnail frames.
  useEffect(() => {
    if (!duration || !Number.isFinite(duration)) return;

    let isActive = true;

    const generateTimelineFrames = async () => {
      try {
        setIsGeneratingFrames(true);
        setTimelineFrames([]);

        const frameCount = Math.min(10, Math.max(2, Math.ceil(duration / 3)));
        const times = Array.from(
          { length: frameCount },
          (_, index) => (duration * index) / frameCount,
        );

        const frames = await player.generateThumbnailsAsync(times, {
          maxWidth: 120,
        });

        if (isActive) {
          setTimelineFrames(frames);
        }
      } catch (error) {
        console.warn("Timeline thumbnail generation failed:", error);
      } finally {
        if (isActive) {
          setIsGeneratingFrames(false);
        }
      }
    };

    void generateTimelineFrames();

    return () => {
      isActive = false;
    };
  }, [duration, player]);

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${String(minutes).padStart(2, "0")}:${String(
      remainingSeconds,
    ).padStart(2, "0")}`;
  };

  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const trimStartProgress = duration > 0 ? trimStart / duration : 0;
  const trimEndProgress = duration > 0 ? trimEnd / duration : 1;

  const timeFromTimelineX = (x: number) => {
    const width = timelineWidthRef.current;
    const videoDuration = durationRef.current;

    if (!width || !videoDuration) return 0;

    const position = Math.max(0, Math.min(x / width, 1));
    return position * videoDuration;
  };

  const seekTimeline = (locationX: number) => {
    if (!durationRef.current || !timelineWidthRef.current) return;

    setPlayheadTime(timeFromTimelineX(locationX));
  };

  const updateTrimStart = (time: number) => {
    const maxStart = Math.max(0, trimEndRef.current - MIN_TRIM_DURATION);
    const nextStart = Math.max(0, Math.min(time, maxStart));

    trimStartRef.current = nextStart;
    setTrimStart(nextStart);

    if (currentTimeRef.current < nextStart) {
      setPlayheadTime(nextStart);
    }
  };

  const updateTrimEnd = (time: number) => {
    const minEnd = trimStartRef.current + MIN_TRIM_DURATION;
    const nextEnd = Math.min(durationRef.current, Math.max(time, minEnd));

    trimEndRef.current = nextEnd;
    setTrimEnd(nextEnd);

    if (currentTimeRef.current > nextEnd) {
      setPlayheadTime(nextEnd);
    }
  };

  const seekToPosition = (locationX: number) => {
    if (!duration || !barWidth) return;

    const position = Math.max(0, Math.min(locationX / barWidth, 1));
    setPlayheadTime(position * duration);
  };

  const seekBy = (seconds: number) => {
    setPlayheadTime(currentTimeRef.current + seconds);
  };

  // Each trim handle has its own responder. Drag distance is calculated
  // from the handle's starting time, not from the touch target's local X.
  const leftHandlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          pauseForDrag();
          leftDragStartTimeRef.current = trimStartRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const deltaTime =
            (gestureState.dx / Math.max(timelineWidthRef.current, 1)) *
            durationRef.current;
          updateTrimStart(leftDragStartTimeRef.current + deltaTime);
        },
        onPanResponderRelease: (_, gestureState) => {
          const deltaTime =
            (gestureState.dx / Math.max(timelineWidthRef.current, 1)) *
            durationRef.current;
          updateTrimStart(leftDragStartTimeRef.current + deltaTime);
          finishDrag();
        },
        onPanResponderTerminate: finishDrag,
      }),
    [],
  );

  const rightHandlePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          pauseForDrag();
          rightDragStartTimeRef.current = trimEndRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const deltaTime =
            (gestureState.dx / Math.max(timelineWidthRef.current, 1)) *
            durationRef.current;
          updateTrimEnd(rightDragStartTimeRef.current + deltaTime);
        },
        onPanResponderRelease: (_, gestureState) => {
          const deltaTime =
            (gestureState.dx / Math.max(timelineWidthRef.current, 1)) *
            durationRef.current;
          updateTrimEnd(rightDragStartTimeRef.current + deltaTime);
          finishDrag();
        },
        onPanResponderTerminate: finishDrag,
      }),
    [],
  );

  const playheadPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          pauseForDrag();
          playheadDragStartTimeRef.current = currentTimeRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const deltaTime =
            (gestureState.dx / Math.max(timelineWidthRef.current, 1)) *
            durationRef.current;
          setPlayheadTime(playheadDragStartTimeRef.current + deltaTime);
        },
        onPanResponderRelease: (_, gestureState) => {
          const deltaTime =
            (gestureState.dx / Math.max(timelineWidthRef.current, 1)) *
            durationRef.current;
          setPlayheadTime(playheadDragStartTimeRef.current + deltaTime);
          finishDrag();
        },
        onPanResponderTerminate: finishDrag,
      }),
    [],
  );

  const handlePlayPause = () => {
    if (isPlaying) {
      player.pause();
      return;
    }

    if (currentTimeRef.current >= trimEndRef.current) {
      setPlayheadTime(trimStartRef.current);
    }

    player.play();
  };

  const leftHandleLeft = `${trimStartProgress * 100}%`;
  const rightHandleLeft = `${trimEndProgress * 100}%`;
  const playheadLeft = `${progress * 100}%`;

  return (
    <View style={styles.container}>
      {/* Video Preview */}
      <View style={styles.videoContainer}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls={false}
          allowsPictureInPicture={false}
        />

        {effectsPreview && (
          <EffectsPreviewOverlay
            player={player}
            freezes={effectsPreview.freezes}
            transitions={effectsPreview.transitions}
          />
        )}
      </View>

      {/* Playback Controls */}
      <View style={styles.controls}>
        <View style={styles.buttonRow}>
          <Pressable onPress={() => seekBy(-5)} style={styles.controlButton}>
            <Text style={styles.skipIcon}>↶</Text>
            <Text style={styles.skipLabel}>5</Text>
          </Pressable>

          <Pressable onPress={handlePlayPause} style={styles.playButton}>
            <Text style={styles.playIcon}>{isPlaying ? "Ⅱ" : "▶"}</Text>
          </Pressable>

          <Pressable onPress={() => seekBy(5)} style={styles.controlButton}>
            <Text style={styles.skipIcon}>↷</Text>
            <Text style={styles.skipLabel}>5</Text>
          </Pressable>
        </View>

        {/* Playback Progress */}
        <Pressable
          style={styles.progressTouchArea}
          onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
          onPress={(event) => seekToPosition(event.nativeEvent.locationX)}
        >
          <View style={styles.progressTrack}>
            <View
              style={[styles.progressFill, { width: `${progress * 100}%` }]}
            />
            <View
              style={[styles.progressThumb, { left: `${progress * 100}%` }]}
            />
          </View>
        </Pressable>

        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
          <Text style={styles.durationText}>{formatTime(duration)}</Text>
        </View>
      </View>

      {/* Trimming Timeline */}
      <View style={styles.timelineContainer}>
        <View style={styles.timelineHeader}>
          <Text style={styles.timelineTitle}>TRIM VIDEO</Text>

          {isDragging && <Text style={styles.loadingText}>Adjusting...</Text>}

          {isGeneratingFrames && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.loadingText}>Generating frames...</Text>
            </View>
          )}
        </View>

        {timelineFrames.length > 0 ? (
          <View
            style={styles.timelineViewport}
            onLayout={(event) => {
              const width = event.nativeEvent.layout.width;
              timelineWidthRef.current = width;
            }}
          >
            {/* Tapping the thumbnail strip seeks; drag controls sit above it. */}
            <Pressable
              style={styles.framesPressable}
              onPress={(event) => seekTimeline(event.nativeEvent.locationX)}
            >
              <View style={styles.framesRow}>
                {timelineFrames.map((frame, index) => (
                  <Image
                    key={`${frame.requestedTime}-${index}`}
                    source={frame}
                    style={styles.timelineFrame}
                    contentFit="cover"
                  />
                ))}
              </View>
            </Pressable>

            {/* Dimmed areas outside the selected range */}
            <View
              pointerEvents="none"
              style={[
                styles.trimShade,
                {
                  left: 0,
                  width: `${trimStartProgress * 100}%`,
                },
              ]}
            />

            <View
              pointerEvents="none"
              style={[
                styles.trimShade,
                {
                  left: `${trimEndProgress * 100}%`,
                  right: 0,
                },
              ]}
            />

            {/* Selected range border */}
            <View
              pointerEvents="none"
              style={[
                styles.selectedRange,
                {
                  left: leftHandleLeft,
                  width: `${(trimEndProgress - trimStartProgress) * 100}%`,
                },
              ]}
            />

            {/* Left trim handle: independent touch target */}
            <View
              {...leftHandlePanResponder.panHandlers}
              style={[
                styles.handleTouchArea,
                {
                  left: leftHandleLeft,
                  marginLeft: -HANDLE_TOUCH_WIDTH / 2,
                },
              ]}
            >
              <View style={styles.trimHandle}>
                <View style={styles.handleGrip} />
              </View>
            </View>

            {/* Right trim handle: independent touch target */}
            <View
              {...rightHandlePanResponder.panHandlers}
              style={[
                styles.handleTouchArea,
                {
                  left: rightHandleLeft,
                  marginLeft: -HANDLE_TOUCH_WIDTH / 2,
                },
              ]}
            >
              <View style={styles.trimHandle}>
                <View style={styles.handleGrip} />
              </View>
            </View>

            {/* White playhead: independent drag target */}
            <View
              {...playheadPanResponder.panHandlers}
              style={[
                styles.playheadTouchArea,
                {
                  left: playheadLeft,
                  marginLeft: -PLAYHEAD_TOUCH_WIDTH / 2,
                },
              ]}
            >
              <View style={styles.playhead}>
                <View style={styles.playheadTop} />
                <View style={styles.playheadLine} />
              </View>
            </View>
          </View>
        ) : (
          !isGeneratingFrames && (
            <Text style={styles.emptyTimeline}>
              Timeline previews are not available.
            </Text>
          )
        )}

        <View style={styles.timelineFooter}>
          <View>
            <Text style={styles.trimLabel}>START</Text>
            <Text style={styles.timelineTime}>{formatTime(trimStart)}</Text>
          </View>

          <View style={styles.trimDuration}>
            <Text style={styles.trimLabel}>SELECTED DURATION</Text>
            <Text style={styles.timelineTime}>
              {formatTime(Math.max(0, trimEnd - trimStart))}
            </Text>
          </View>

          <View>
            <Text style={styles.trimLabel}>END</Text>
            <Text style={styles.timelineDuration}>{formatTime(trimEnd)}</Text>
          </View>
        </View>
      </View>

      <Pressable
        onPress={handleExport}
        disabled={
          isExporting || !duration || trimEnd - trimStart < MIN_TRIM_DURATION
        }
        style={[
          styles.exportButton,
          isExporting && styles.exportButtonDisabled,
        ]}
      >
        {isExporting ? (
          <>
            <ActivityIndicator color="#fff" />
            <Text style={styles.exportButtonText}>Exporting...</Text>
          </>
        ) : (
          <Text style={styles.exportButtonText}>Export Trimmed Video</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  exportButton: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 16,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  exportButtonDisabled: {
    opacity: 0.6,
  },
  exportButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  container: {
    width: "100%",
    backgroundColor: "#000000",
    borderRadius: 12,
    overflow: "hidden",
  },
  videoContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
  },
  video: {
    width: "100%",
    height: "100%",
  },
  controls: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    backgroundColor: "#17171B",
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 38,
    paddingVertical: 12,
  },
  controlButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  skipIcon: {
    color: "#FFFFFF",
    fontSize: 29,
    fontWeight: "600",
  },
  skipLabel: {
    color: "#FFFFFF",
    fontSize: 10,
    position: "absolute",
    top: 18,
    fontWeight: "700",
  },
  playButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    color: "#17171B",
    fontSize: 22,
    fontWeight: "700",
  },
  progressTouchArea: {
    height: 24,
    justifyContent: "center",
  },
  progressTrack: {
    height: 4,
    backgroundColor: "#55555B",
    borderRadius: 4,
    justifyContent: "center",
  },
  progressFill: {
    height: 4,
    backgroundColor: C.primary,
    borderRadius: 4,
  },
  progressThumb: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    marginLeft: -6,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
  },
  timeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  durationText: {
    color: "#A0A0A8",
    fontSize: 12,
  },
  timelineContainer: {
    padding: 12,
    backgroundColor: "#101014",
    gap: 10,
  },
  timelineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timelineTitle: {
    color: "#A0A0A8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  loadingText: {
    color: "#A0A0A8",
    fontSize: 11,
  },
  timelineViewport: {
    height: 62,
    position: "relative",
    overflow: "hidden",
    borderRadius: 4,
    backgroundColor: "#292932",
  },
  framesPressable: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  framesRow: {
    flex: 1,
    flexDirection: "row",
  },
  timelineFrame: {
    flex: 1,
    height: "100%",
    minWidth: 0,
  },
  trimShade: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  selectedRange: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: C.primary,
  },
  handleTouchArea: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: HANDLE_TOUCH_WIDTH,
    zIndex: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  trimHandle: {
    width: 14,
    height: "100%",
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  handleGrip: {
    width: 3,
    height: 22,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
  playheadTouchArea: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: PLAYHEAD_TOUCH_WIDTH,
    zIndex: 4,
    alignItems: "center",
  },
  playhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    alignItems: "center",
  },
  playheadTop: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: "#FFFFFF",
  },
  playheadLine: {
    flex: 1,
    width: 2,
    backgroundColor: "#FFFFFF",
  },
  emptyTimeline: {
    color: "#777780",
    fontSize: 12,
    paddingVertical: 12,
  },
  timelineFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  trimLabel: {
    color: "#777780",
    fontSize: 9,
    fontWeight: "700",
    marginBottom: 3,
  },
  timelineTime: {
    color: C.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  timelineDuration: {
    color: "#A0A0A8",
    fontSize: 11,
  },
  trimDuration: {
    alignItems: "center",
  },
});
