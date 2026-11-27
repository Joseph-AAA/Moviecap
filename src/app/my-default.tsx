import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MovieCapColors as C } from "@/constants/theme";
import { getMyDefaultPreset, saveMyDefaultPreset } from "@/services/database";
import {
  DEFAULT_FREEZE_DURATION,
  DEFAULT_FREEZE_ZOOM_TO,
  PRESET_FREEZE_DURATIONS,
  PRESET_ZOOM_LEVELS,
  createStarterPreset,
} from "@/services/timeline/editTimeline";
import {
  MAX_REFERENCE_DURATION,
  MIN_REFERENCE_DURATION,
  PRESET_TRANSITION_DURATIONS,
  dragMarker,
  findFreeSpot,
  formatClock,
  isMarkerOverlapping,
  parseClock,
  presetProblems,
  referenceDuration,
  settleMarker,
  sortPreset,
  type MarkerRef,
} from "@/services/timeline/presetLayout";
import type { MyDefaultPreset, TransitionKind, ZoomDirection } from "@/types/edit";

const TRANSITION_COLOR = "#3B82F6"; // blue
const FREEZE_COLOR = "#F59E0B"; // amber
const BLOCKED_COLOR = "#EF4444"; // red: dragging over another line
const LABEL_WIDTH = 52;

const KINDS: { kind: TransitionKind; label: string }[] = [
  { kind: "dissolve", label: "Dissolve" },
  { kind: "fade", label: "Crossfade" },
  { kind: "fadeblack", label: "Fade to black" },
  { kind: "slideleft", label: "Slide left" },
  { kind: "slideright", label: "Slide right" },
];

const DIRECTIONS: { value: ZoomDirection; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "top-left", label: "↖" },
  { value: "top-right", label: "↗" },
  { value: "bottom-left", label: "↙" },
  { value: "bottom-right", label: "↘" },
];

/**
 * Set up "My Default": the user's own reusable default edit, laid out on a
 * reference length (e.g. 2:10). Blue lines are transitions, amber lines are
 * freezes; drag them on the timeline. Positions are saved relative to the
 * length, so My Default fits any video.
 */
export default function MyDefaultScreen() {
  const router = useRouter();
  const [preset, setPreset] = useState<MyDefaultPreset | null>(null);
  const [lengthText, setLengthText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let isActive = true;
    getMyDefaultPreset()
      .then((saved) => {
        if (!isActive) return;
        const loaded = saved ?? createStarterPreset();
        setPreset(loaded);
        setLengthText(formatClock(referenceDuration(loaded)));
      })
      .catch((error) => {
        console.error("Failed to load My Default:", error);
        if (!isActive) return;
        const starter = createStarterPreset();
        setPreset(starter);
        setLengthText(formatClock(referenceDuration(starter)));
      });
    return () => {
      isActive = false;
    };
  }, []);

  const problems = preset ? presetProblems(preset) : [];
  const reference = preset ? referenceDuration(preset) : 0;

  const commitLength = () => {
    if (!preset) return;
    const seconds = parseClock(lengthText);
    if (seconds === null || seconds < MIN_REFERENCE_DURATION || seconds > MAX_REFERENCE_DURATION) {
      Alert.alert("Check the length", "Type minutes:seconds, for example 2:10 (between 0:10 and 3:00:00).");
      setLengthText(formatClock(reference));
      return;
    }
    setPreset({ ...preset, referenceDuration: seconds });
    setLengthText(formatClock(seconds));
  };

  const save = async () => {
    if (!preset || isSaving) return;
    if (problems.length > 0) {
      Alert.alert("Fix the timeline first", problems.join("\n"));
      return;
    }
    try {
      setIsSaving(true);
      await saveMyDefaultPreset({
        ...preset,
        transitions: [...preset.transitions].sort((a, b) => a.position - b.position),
        freezes: [...preset.freezes].sort((a, b) => a.position - b.position),
        updatedAt: new Date().toISOString(),
      });
      Alert.alert("Saved", "My Default is ready. Use “Apply My Default” on any video.");
      router.back();
    } catch (error) {
      console.error("Failed to save My Default:", error);
      Alert.alert("Could not save", "Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const updateTransition = (index: number, patch: Partial<MyDefaultPreset["transitions"][number]>) =>
    setPreset((p) =>
      p && { ...p, transitions: p.transitions.map((t, i) => (i === index ? { ...t, ...patch } : t)) },
    );

  const updateFreeze = (index: number, patch: Partial<MyDefaultPreset["freezes"][number]>) =>
    setPreset((p) =>
      p && { ...p, freezes: p.freezes.map((f, i) => (i === index ? { ...f, ...patch } : f)) },
    );

  const addTransition = () => {
    if (!preset) return;
    const at = findFreeSpot(preset, 0);
    if (at === null) {
      Alert.alert("No room", "Drag the lines apart or make the total length longer.");
      return;
    }
    setPreset({
      ...preset,
      transitions: [...preset.transitions, { position: at / reference, kind: "dissolve", duration: 0.5 }],
    });
  };

  const addFreeze = () => {
    if (!preset) return;
    const at = findFreeSpot(preset, DEFAULT_FREEZE_DURATION);
    if (at === null) {
      Alert.alert("No room", "A 5 s freeze doesn't fit between the lines. Drag them apart or make the total length longer.");
      return;
    }
    setPreset({
      ...preset,
      freezes: [
        ...preset.freezes,
        { position: at / reference, duration: DEFAULT_FREEZE_DURATION, zoomTo: DEFAULT_FREEZE_ZOOM_TO, zoomDirection: "center" },
      ],
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>My Default</Text>
        <Pressable onPress={() => void save()} disabled={!preset || isSaving} hitSlop={8}>
          {isSaving ? (
            <ActivityIndicator color={C.primary} />
          ) : (
            <Text style={[styles.saveText, problems.length > 0 && { opacity: 0.4 }]}>Save</Text>
          )}
        </Pressable>
      </View>

      {!preset ? (
        <ActivityIndicator size="large" color={C.primary} style={{ flex: 1 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content} scrollEnabled={!isDragging}>
          {/* Total length */}
          <View style={styles.lengthRow}>
            <Text style={styles.lengthLabel}>Total length</Text>
            <TextInput
              value={lengthText}
              onChangeText={setLengthText}
              onEndEditing={commitLength}
              onSubmitEditing={commitLength}
              keyboardType="numbers-and-punctuation"
              returnKeyType="done"
              style={styles.lengthInput}
              placeholder="2:10"
              placeholderTextColor={C.secondaryText}
            />
            <Text style={styles.lengthHint}>min:sec</Text>
          </View>
          <Text style={styles.help}>
            Lay out your edit on this length. On other videos everything keeps
            the same relative place (a line at the middle stays in the middle).
          </Text>

          {/* Timeline */}
          <PresetTimeline
            preset={preset}
            onChange={setPreset}
            onDraggingChange={setIsDragging}
          />

          {problems.length > 0 && (
            <View style={styles.problemBox}>
              {problems.map((problem) => (
                <Text key={problem} style={styles.problemText}>
                  ⚠ {problem}
                </Text>
              ))}
            </View>
          )}

          {/* Transitions */}
          <Text style={styles.sectionTitle}>TRANSITIONS ({preset.transitions.length})</Text>
          {preset.transitions.map((t, i) => (
            <View key={`tr${i}`} style={[styles.card, { borderLeftColor: TRANSITION_COLOR }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  Transition {i + 1} · {formatClock(t.position * reference)}
                </Text>
                <Pressable
                  onPress={() =>
                    setPreset((p) => p && { ...p, transitions: p.transitions.filter((_, j) => j !== i) })
                  }
                  hitSlop={6}
                >
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
              <ChipRow>
                {KINDS.map(({ kind, label }) => (
                  <Chip key={kind} label={label} selected={t.kind === kind} onPress={() => updateTransition(i, { kind })} />
                ))}
              </ChipRow>
              <ChipRow>
                {PRESET_TRANSITION_DURATIONS.map((d) => (
                  <Chip key={d} label={`${d}s`} selected={t.duration === d} onPress={() => updateTransition(i, { duration: d })} />
                ))}
              </ChipRow>
            </View>
          ))}
          <AddButton label="+ Add transition" onPress={addTransition} />

          {/* Freezes */}
          <Text style={styles.sectionTitle}>FREEZE FRAMES ({preset.freezes.length})</Text>
          <Text style={styles.help}>
            Each freeze replaces that part of the video with a zooming still;
            the audio keeps playing.
          </Text>
          {preset.freezes.map((f, i) => (
            <View key={`fr${i}`} style={[styles.card, { borderLeftColor: FREEZE_COLOR }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  Freeze {i + 1} · {formatClock(f.position * reference)}–
                  {formatClock(f.position * reference + f.duration)}
                </Text>
                <Pressable
                  onPress={() =>
                    setPreset((p) => p && { ...p, freezes: p.freezes.filter((_, j) => j !== i) })
                  }
                  hitSlop={6}
                >
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
              <Text style={styles.label}>Length</Text>
              <ChipRow>
                {PRESET_FREEZE_DURATIONS.map((d) => (
                  <Chip key={d} label={`${d}s`} selected={f.duration === d} onPress={() => updateFreeze(i, { duration: d })} />
                ))}
              </ChipRow>
              <Text style={styles.label}>Zoom</Text>
              <ChipRow>
                {PRESET_ZOOM_LEVELS.map((z) => (
                  <Chip key={z} label={z === 1 ? "None" : `${z}×`} selected={f.zoomTo === z} onPress={() => updateFreeze(i, { zoomTo: z })} />
                ))}
              </ChipRow>
              <Text style={styles.label}>Zoom towards</Text>
              <ChipRow>
                {DIRECTIONS.map(({ value, label }) => (
                  <Chip key={value} label={label} selected={f.zoomDirection === value} onPress={() => updateFreeze(i, { zoomDirection: value })} />
                ))}
              </ChipRow>
            </View>
          ))}
          <AddButton label="+ Add freeze frame" onPress={addFreeze} />

          <Pressable
            onPress={() =>
              Alert.alert("Start over?", "Replace My Default with the starter layout?", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Reset",
                  style: "destructive",
                  onPress: () => {
                    const starter = createStarterPreset();
                    setPreset(starter);
                    setLengthText(formatClock(referenceDuration(starter)));
                  },
                },
              ])
            }
            style={{ alignSelf: "center", padding: 12 }}
          >
            <Text style={{ color: C.secondaryText, fontSize: 13 }}>Reset to starter layout</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Timeline with draggable lines
// ---------------------------------------------------------------------------

function PresetTimeline({
  preset,
  onChange,
  onDraggingChange,
}: {
  preset: MyDefaultPreset;
  onChange: (preset: MyDefaultPreset) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const [width, setWidth] = useState(0);
  const reference = referenceDuration(preset);
  const toX = (seconds: number) => (seconds / reference) * width;

  // Labels: stagger to a second row when two of the same colour are close.
  const labelRows = (items: { key: string; x: number }[]) => {
    const rows: Record<string, number> = {};
    let lastX = -Infinity;
    let lastRow = 1;
    [...items]
      .sort((a, b) => a.x - b.x)
      .forEach((item) => {
        const row = item.x - lastX < LABEL_WIDTH ? (lastRow === 0 ? 1 : 0) : 0;
        rows[item.key] = row;
        lastX = item.x;
        lastRow = row;
      });
    return rows;
  };

  const transitionItems = preset.transitions.map((t, i) => ({ key: `t${i}`, x: toX(t.position * reference) }));
  const freezeItems = preset.freezes.map((f, i) => ({ key: `f${i}`, x: toX(f.position * reference) }));
  const transitionRows = labelRows(transitionItems);
  const freezeRows = labelRows(freezeItems);

  // Free drag: follow the finger (even over other lines). On release, settle
  // on the nearest free spot (or go back if there is none) and renumber.
  const beforeDragRef = useRef<MyDefaultPreset | null>(null);
  const dragStart = () => {
    beforeDragRef.current = preset;
  };
  const drag = (ref: MarkerRef, seconds: number) => onChange(dragMarker(preset, ref, seconds));
  const dragEnd = (ref: MarkerRef) => {
    const fallback = beforeDragRef.current ?? preset;
    onChange(sortPreset(settleMarker(preset, ref, fallback)));
    beforeDragRef.current = null;
  };
  const lineColor = (ref: MarkerRef, normal: string) =>
    isMarkerOverlapping(preset, ref) ? BLOCKED_COLOR : normal;

  return (
    <View>
      <View
        style={styles.timeline}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {/* Freeze bands (how long each freeze lasts) */}
        {preset.freezes.map((f, i) => (
          <View
            key={`band${i}`}
            pointerEvents="none"
            style={[
              styles.freezeBand,
              { left: toX(f.position * reference), width: Math.max(2, toX(f.duration)) },
            ]}
          />
        ))}

        {width > 0 &&
          preset.transitions.map((t, i) => (
            <DraggableLine
              key={`tl${i}`}
              markerRef={{ type: "transition", index: i }}
              seconds={t.position * reference}
              x={toX(t.position * reference)}
              secondsPerPixel={reference / width}
              color={lineColor({ type: "transition", index: i }, TRANSITION_COLOR)}
              onDragStart={dragStart}
              onDrag={drag}
              onDragEnd={dragEnd}
              onDraggingChange={onDraggingChange}
            />
          ))}

        {width > 0 &&
          preset.freezes.map((f, i) => (
            <DraggableLine
              key={`fl${i}`}
              markerRef={{ type: "freeze", index: i }}
              seconds={f.position * reference}
              x={toX(f.position * reference)}
              secondsPerPixel={reference / width}
              color={lineColor({ type: "freeze", index: i }, FREEZE_COLOR)}
              onDragStart={dragStart}
              onDrag={drag}
              onDragEnd={dragEnd}
              onDraggingChange={onDraggingChange}
            />
          ))}
      </View>

      {/* Times under the lines */}
      <View style={styles.labelArea}>
        {preset.transitions.map((t, i) => (
          <Text
            key={`tlabel${i}`}
            style={[
              styles.timeLabel,
              {
                color: TRANSITION_COLOR,
                left: transitionItems[i].x - LABEL_WIDTH / 2,
                top: transitionRows[`t${i}`] * 16,
              },
            ]}
          >
            {formatClock(t.position * reference)}
          </Text>
        ))}
        {preset.freezes.map((f, i) => (
          <Text
            key={`flabel${i}`}
            style={[
              styles.timeLabel,
              {
                color: FREEZE_COLOR,
                left: freezeItems[i].x - LABEL_WIDTH / 2,
                top: 34 + freezeRows[`f${i}`] * 16,
              },
            ]}
          >
            ❄ {formatClock(f.position * reference)}
          </Text>
        ))}
      </View>

      <View style={styles.legendRow}>
        <Text style={[styles.legend, { color: TRANSITION_COLOR }]}>│ transition</Text>
        <Text style={[styles.legend, { color: FREEZE_COLOR }]}>│ freeze</Text>
        <Text style={styles.legend}>drag the lines</Text>
        <Text style={styles.legend}>{formatClock(reference)}</Text>
      </View>
    </View>
  );
}

function DraggableLine({
  markerRef,
  seconds,
  x,
  secondsPerPixel,
  color,
  onDragStart,
  onDrag,
  onDragEnd,
  onDraggingChange,
}: {
  markerRef: MarkerRef;
  seconds: number;
  x: number;
  secondsPerPixel: number;
  color: string;
  onDragStart: () => void;
  onDrag: (ref: MarkerRef, seconds: number) => void;
  onDragEnd: (ref: MarkerRef) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  // Latest props for the (stable) gesture handlers.
  const latest = useRef({ markerRef, seconds, secondsPerPixel, onDragStart, onDrag, onDragEnd, onDraggingChange });
  useEffect(() => {
    latest.current = { markerRef, seconds, secondsPerPixel, onDragStart, onDrag, onDragEnd, onDraggingChange };
  });

  const startSecondsRef = useRef(0);
  const [isActive, setIsActive] = useState(false);

  // The refs are read only inside gesture callbacks (on touch), never while
  // rendering; a stable responder is required so a drag isn't reset midway.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startSecondsRef.current = latest.current.seconds;
        setIsActive(true);
        latest.current.onDragStart();
        latest.current.onDraggingChange(true);
      },
      onPanResponderMove: (_, gesture) => {
        const { markerRef: ref, secondsPerPixel: spp, onDrag: move } = latest.current;
        move(ref, startSecondsRef.current + gesture.dx * spp);
      },
      onPanResponderRelease: () => {
        setIsActive(false);
        latest.current.onDragEnd(latest.current.markerRef);
        latest.current.onDraggingChange(false);
      },
      onPanResponderTerminate: () => {
        setIsActive(false);
        latest.current.onDragEnd(latest.current.markerRef);
        latest.current.onDraggingChange(false);
      },
    }),
  );

  return (
    <View
      {...responder.panHandlers}
      hitSlop={{ top: 8, bottom: 8 }}
      style={[styles.lineTouch, { left: x - 16 }]}
    >
      <View style={[styles.line, { backgroundColor: color, width: isActive ? 5 : 3 }]} />
      <View style={[styles.lineKnob, { backgroundColor: color, transform: [{ scale: isActive ? 1.3 : 1 }] }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Small UI pieces
// ---------------------------------------------------------------------------

function ChipRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: selected ? C.primary : C.border,
        backgroundColor: selected ? "rgba(139,92,246,0.2)" : C.elevated,
      }}
    >
      <Text style={{ color: selected ? C.text : C.secondaryText, fontSize: 13, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.addButton}>
      <Text style={styles.addText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 8,
  },
  backButton: { width: 40, height: 40, justifyContent: "center" },
  backText: { color: C.text, fontSize: 34 },
  headerTitle: { flex: 1, color: C.text, fontSize: 17, fontWeight: "700" },
  saveText: { color: C.primaryLight, fontSize: 16, fontWeight: "700" },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  help: { color: C.secondaryText, fontSize: 12 },
  lengthRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  lengthLabel: { color: C.text, fontSize: 15, fontWeight: "700", flex: 1 },
  lengthInput: {
    minWidth: 90,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.elevated,
    color: C.text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  lengthHint: { color: C.secondaryText, fontSize: 12 },
  timeline: {
    height: 56,
    borderRadius: 8,
    backgroundColor: C.elevated,
    marginTop: 6,
  },
  freezeBand: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(245,158,11,0.22)",
  },
  lineTouch: {
    position: "absolute",
    top: -6,
    bottom: -6,
    width: 32,
    alignItems: "center",
  },
  line: { flex: 1, borderRadius: 2 },
  lineKnob: {
    position: "absolute",
    top: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  labelArea: { height: 68, marginTop: 4 },
  timeLabel: {
    position: "absolute",
    width: LABEL_WIDTH,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
  },
  legendRow: { flexDirection: "row", justifyContent: "space-between" },
  legend: { color: C.secondaryText, fontSize: 11 },
  problemBox: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: "rgba(239,68,68,0.12)",
    gap: 4,
  },
  problemText: { color: C.danger, fontSize: 12 },
  sectionTitle: {
    color: C.secondaryText,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 8,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 4,
    padding: 12,
    gap: 10,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  deleteText: { color: C.danger, fontSize: 13, fontWeight: "600" },
  label: { color: C.secondaryText, fontSize: 11, fontWeight: "700" },
  addButton: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  addText: { color: C.primaryLight, fontSize: 14, fontWeight: "600" },
});
