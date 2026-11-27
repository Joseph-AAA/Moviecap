import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { MovieCapColors as C } from "@/constants/theme";
import {
  DEFAULT_CUSTOM_TRANSITION_DURATION,
  TRANSITION_DURATION_CHOICES,
  TRANSITION_OPTIONS as KINDS,
} from "@/constants/transitions";
import { getMyDefaultPreset, saveMyDefaultPreset } from "@/services/database";
import {
  DEFAULT_FREEZE_DURATION,
  DEFAULT_FREEZE_ZOOM_TO,
  PRESET_FREEZE_DURATIONS,
  PRESET_ZOOM_LEVELS,
  createStarterPreset,
  presetEffectTimes,
} from "@/services/timeline/editTimeline";
import {
  EDGE_SECONDS,
  MAX_PATTERN_LENGTH,
  MIN_PATTERN_LENGTH,
  dragMarker,
  findFreeSpot,
  formatClock,
  isMarkerOverlapping,
  layoutLength,
  parseClock,
  presetProblems,
  settleMarker,
  sortPreset,
  type MarkerRef,
} from "@/services/timeline/presetLayout";
import type { MyDefaultPreset, ZoomDirection } from "@/types/edit";

const TRANSITION_COLOR = "#3B82F6"; // blue
const FREEZE_COLOR = "#F59E0B"; // amber
const BLOCKED_COLOR = "#EF4444"; // red: dragging over another line
const LABEL_WIDTH = 52;
const PREVIEW_TIMES = 12;

const DIRECTIONS: { value: ZoomDirection; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "top-left", label: "↖" },
  { value: "top-right", label: "↗" },
  { value: "bottom-left", label: "↙" },
  { value: "bottom-right", label: "↘" },
];

/**
 * Set up "My Default": the user's own reusable default edit, in SECONDS.
 * - Repeat ON: lay out one round (editable Total length); it repeats until
 *   the video ends.
 * - Repeat OFF: lay out exact times on the current video's real length.
 * Blue lines are transitions, amber lines are freezes; drag them freely.
 */
export default function MyDefaultScreen() {
  const router = useRouter();
  // The video the user came from (Edit page), for the real length.
  const params = useLocalSearchParams<{ videoDuration?: string }>();
  const videoDuration = Number(params.videoDuration) > 0 ? Number(params.videoDuration) : 0;

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
        setLengthText(formatClock(loaded.patternLength));
      })
      .catch((error) => {
        console.error("Failed to load My Default:", error);
        if (!isActive) return;
        const starter = createStarterPreset();
        setPreset(starter);
        setLengthText(formatClock(starter.patternLength));
      });
    return () => {
      isActive = false;
    };
  }, []);

  const length = preset ? layoutLength(preset, videoDuration) : 0;

  // Exact times (OFF): lines after the video's end are HIDDEN (not deleted,
  // no warnings); they come back when Repeat is turned ON.
  const split = (full: MyDefaultPreset) => {
    const fits = (end: number) => full.repeat || end <= length - EDGE_SECONDS + 0.001;
    return {
      visible: {
        ...full,
        transitions: full.transitions.filter((t) => fits(t.at)),
        freezes: full.freezes.filter((f) => fits(f.at + f.duration)),
      },
      hidden: {
        transitions: full.transitions.filter((t) => !fits(t.at)),
        freezes: full.freezes.filter((f) => !fits(f.at + f.duration)),
      },
    };
  };
  /** Edit only the visible lines/cards; hidden ones are kept as they are. */
  const editVisible = (change: (visible: MyDefaultPreset) => MyDefaultPreset) =>
    setPreset((full) => {
      if (!full) return full;
      const { visible, hidden } = split(full);
      const next = change(visible);
      return sortPreset({
        ...next,
        transitions: [...next.transitions, ...hidden.transitions],
        freezes: [...next.freezes, ...hidden.freezes],
      });
    });
  const view = preset ? split(preset) : null;
  const visiblePreset = view?.visible ?? null;
  const hiddenCount = view
    ? { transitions: view.hidden.transitions.length, freezes: view.hidden.freezes.length }
    : { transitions: 0, freezes: 0 };
  const problems = visiblePreset ? presetProblems(visiblePreset, length) : [];
  const effectTimes =
    preset && videoDuration > 0 ? presetEffectTimes(videoDuration, preset) : null;

  const commitLength = () => {
    if (!preset) return;
    const seconds = parseClock(lengthText);
    if (seconds === null || seconds < MIN_PATTERN_LENGTH || seconds > MAX_PATTERN_LENGTH) {
      Alert.alert("Check the length", "Type minutes:seconds, for example 0:50 or 2:00.");
      setLengthText(formatClock(preset.patternLength));
      return;
    }
    setPreset({ ...preset, patternLength: seconds });
    setLengthText(formatClock(seconds));
  };

  const setRepeat = (repeat: boolean) => {
    if (!preset) return;
    if (!repeat && videoDuration <= 0) {
      Alert.alert("Open from a video", "Exact times use the real video length. Open My Default from a video's Edit page.");
      return;
    }
    setPreset({ ...preset, repeat });
  };

  const save = async () => {
    if (!preset || isSaving) return;
    if (problems.length > 0) {
      Alert.alert("Fix the timeline first", problems.join("\n"));
      return;
    }
    try {
      setIsSaving(true);
      await saveMyDefaultPreset({ ...sortPreset(preset), updatedAt: new Date().toISOString() });
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
    editVisible((v) => ({ ...v, transitions: v.transitions.map((t, i) => (i === index ? { ...t, ...patch } : t)) }));

  const updateFreeze = (index: number, patch: Partial<MyDefaultPreset["freezes"][number]>) =>
    editVisible((v) => ({ ...v, freezes: v.freezes.map((f, i) => (i === index ? { ...f, ...patch } : f)) }));

  const deleteTransition = (index: number) =>
    editVisible((v) => ({ ...v, transitions: v.transitions.filter((_, j) => j !== index) }));

  const deleteFreeze = (index: number) =>
    editVisible((v) => ({ ...v, freezes: v.freezes.filter((_, j) => j !== index) }));

  const addTransition = () => {
    if (!visiblePreset) return;
    const at = findFreeSpot(visiblePreset, length, 0);
    if (at === null) {
      Alert.alert("No room", "Drag the lines apart or make the total length longer.");
      return;
    }
    editVisible((v) => ({
      ...v,
      transitions: [...v.transitions, { at, kind: "fade", duration: DEFAULT_CUSTOM_TRANSITION_DURATION }],
    }));
  };

  const addFreeze = () => {
    if (!visiblePreset) return;
    const at = findFreeSpot(visiblePreset, length, DEFAULT_FREEZE_DURATION);
    if (at === null) {
      Alert.alert("No room", "A 5 s freeze doesn't fit between the lines. Drag them apart or make the total length longer.");
      return;
    }
    editVisible((v) => ({
      ...v,
      freezes: [
        ...v.freezes,
        { at, duration: DEFAULT_FREEZE_DURATION, zoomTo: DEFAULT_FREEZE_ZOOM_TO, zoomDirection: "center" },
      ],
    }));
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
          {/* Repeat switch */}
          <View style={styles.switchRow}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.switchTitle}>Repeat pattern until the video ends</Text>
              <Text style={styles.help}>
                {preset.repeat
                  ? "ON: the lines below are one round; it repeats every Total length."
                  : "OFF: the lines are exact times on this video, once."}
              </Text>
            </View>
            <Switch
              value={preset.repeat}
              onValueChange={setRepeat}
              trackColor={{ false: C.elevated, true: C.primary }}
              thumbColor="#fff"
            />
          </View>

          {/* Total length: editable round length (ON) or the video's real length (OFF) */}
          <View style={styles.lengthRow}>
            <Text style={styles.lengthLabel}>
              {preset.repeat ? "Total length (one round)" : "Video length"}
            </Text>
            {preset.repeat ? (
              <TextInput
                value={lengthText}
                onChangeText={setLengthText}
                onEndEditing={commitLength}
                onSubmitEditing={commitLength}
                keyboardType="numbers-and-punctuation"
                returnKeyType="done"
                style={styles.lengthInput}
                placeholder="0:50"
                placeholderTextColor={C.secondaryText}
              />
            ) : (
              <Text style={[styles.lengthInput, styles.lengthLocked]}>{formatClock(length)}</Text>
            )}
            <Text style={styles.lengthHint}>min:sec</Text>
          </View>

          {/* Timeline */}
          <PresetTimeline
            preset={visiblePreset ?? preset}
            length={length}
            onChange={(next) => editVisible(() => next)}
            onDraggingChange={setIsDragging}
          />

          {hiddenCount.transitions + hiddenCount.freezes > 0 && (
            <Text style={styles.help}>
              {[
                hiddenCount.transitions > 0 &&
                  `${hiddenCount.transitions} transition${hiddenCount.transitions === 1 ? "" : "s"}`,
                hiddenCount.freezes > 0 &&
                  `${hiddenCount.freezes} freeze${hiddenCount.freezes === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" and ")}{" "}
              after {formatClock(length)} {hiddenCount.transitions + hiddenCount.freezes === 1 ? "is" : "are"} hidden
              (they come back when Repeat is ON).
            </Text>
          )}

          {problems.length > 0 && (
            <View style={styles.problemBox}>
              {problems.map((problem) => (
                <Text key={problem} style={styles.problemText}>
                  ⚠ {problem}
                </Text>
              ))}
            </View>
          )}

          {/* Where the effects land on the current video */}
          {effectTimes && (
            <View style={styles.resultBox}>
              <Text style={styles.resultTitle}>On this video ({formatClock(videoDuration)})</Text>
              <Text style={[styles.resultText, { color: TRANSITION_COLOR }]}>
                │ {effectTimes.transitions.length} transitions:{" "}
                {effectTimes.transitions.slice(0, PREVIEW_TIMES).map(formatClock).join("  ")}
                {effectTimes.transitions.length > PREVIEW_TIMES ? "  …" : ""}
              </Text>
              <Text style={[styles.resultText, { color: FREEZE_COLOR }]}>
                ❄ {effectTimes.freezes.length} freezes:{" "}
                {effectTimes.freezes.slice(0, PREVIEW_TIMES).map(formatClock).join("  ")}
                {effectTimes.freezes.length > PREVIEW_TIMES ? "  …" : ""}
              </Text>
            </View>
          )}

          {/* Transitions */}
          <Text style={styles.sectionTitle}>TRANSITIONS ({(visiblePreset ?? preset).transitions.length})</Text>
          {(visiblePreset ?? preset).transitions.map((t, i) => (
            <View key={`tr${i}`} style={[styles.card, { borderLeftColor: TRANSITION_COLOR }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  Transition {i + 1} · {formatClock(t.at)}
                </Text>
                <Pressable onPress={() => deleteTransition(i)} hitSlop={6}>
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
              <ChipRow>
                {KINDS.map(({ kind, label }) => (
                  <Chip key={kind} label={label} selected={t.kind === kind} onPress={() => updateTransition(i, { kind })} />
                ))}
              </ChipRow>
              <ChipRow>
                {TRANSITION_DURATION_CHOICES.map((d) => (
                  <Chip key={d} label={`${d}s`} selected={t.duration === d} onPress={() => updateTransition(i, { duration: d })} />
                ))}
              </ChipRow>
            </View>
          ))}
          <AddButton label="+ Add transition" onPress={addTransition} />

          {/* Freezes */}
          <Text style={styles.sectionTitle}>FREEZE FRAMES ({(visiblePreset ?? preset).freezes.length})</Text>
          <Text style={styles.help}>
            Each freeze replaces that part of the video with a zooming still;
            the audio keeps playing.
          </Text>
          {(visiblePreset ?? preset).freezes.map((f, i) => (
            <View key={`fr${i}`} style={[styles.card, { borderLeftColor: FREEZE_COLOR }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  Freeze {i + 1} · {formatClock(f.at)}–{formatClock(f.at + f.duration)}
                </Text>
                <Pressable onPress={() => deleteFreeze(i)} hitSlop={6}>
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
                    setLengthText(formatClock(starter.patternLength));
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
// Timeline with freely draggable lines
// ---------------------------------------------------------------------------

function PresetTimeline({
  preset,
  length,
  onChange,
  onDraggingChange,
}: {
  preset: MyDefaultPreset;
  length: number;
  onChange: (preset: MyDefaultPreset) => void;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const [width, setWidth] = useState(0);
  const toX = (seconds: number) => (seconds / length) * width;

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

  const transitionItems = preset.transitions.map((t, i) => ({ key: `t${i}`, x: toX(t.at) }));
  const freezeItems = preset.freezes.map((f, i) => ({ key: `f${i}`, x: toX(f.at) }));
  const transitionRows = labelRows(transitionItems);
  const freezeRows = labelRows(freezeItems);

  // Free drag; on release settle on the nearest free spot and renumber.
  const beforeDragRef = useRef<MyDefaultPreset | null>(null);
  const dragStart = () => {
    beforeDragRef.current = preset;
  };
  const drag = (ref: MarkerRef, seconds: number) => onChange(dragMarker(preset, length, ref, seconds));
  const dragEnd = (ref: MarkerRef) => {
    const fallback = beforeDragRef.current ?? preset;
    onChange(sortPreset(settleMarker(preset, length, ref, fallback)));
    beforeDragRef.current = null;
  };
  const lineColor = (ref: MarkerRef, normal: string) =>
    isMarkerOverlapping(preset, length, ref) ? BLOCKED_COLOR : normal;

  return (
    <View>
      <View style={styles.timeline} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {preset.freezes.map((f, i) => (
          <View
            key={`band${i}`}
            pointerEvents="none"
            style={[styles.freezeBand, { left: toX(f.at), width: Math.max(2, toX(f.duration)) }]}
          />
        ))}

        {width > 0 &&
          preset.transitions.map((t, i) => (
            <DraggableLine
              key={`tl${i}`}
              markerRef={{ type: "transition", index: i }}
              seconds={t.at}
              x={toX(t.at)}
              secondsPerPixel={length / width}
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
              seconds={f.at}
              x={toX(f.at)}
              secondsPerPixel={length / width}
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
              { color: TRANSITION_COLOR, left: transitionItems[i].x - LABEL_WIDTH / 2, top: transitionRows[`t${i}`] * 16 },
            ]}
          >
            {formatClock(t.at)}
          </Text>
        ))}
        {preset.freezes.map((f, i) => (
          <Text
            key={`flabel${i}`}
            style={[
              styles.timeLabel,
              { color: FREEZE_COLOR, left: freezeItems[i].x - LABEL_WIDTH / 2, top: 34 + freezeRows[`f${i}`] * 16 },
            ]}
          >
            ❄ {formatClock(f.at)}
          </Text>
        ))}
      </View>

      <View style={styles.legendRow}>
        <Text style={[styles.legend, { color: TRANSITION_COLOR }]}>│ transition</Text>
        <Text style={[styles.legend, { color: FREEZE_COLOR }]}>│ freeze</Text>
        <Text style={styles.legend}>drag the lines</Text>
        <Text style={styles.legend}>{formatClock(length)}</Text>
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
    <View {...responder.panHandlers} hitSlop={{ top: 8, bottom: 8 }} style={[styles.lineTouch, { left: x - 16 }]}>
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
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  switchTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
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
  lengthLocked: { color: C.secondaryText, opacity: 0.7 },
  lengthHint: { color: C.secondaryText, fontSize: 12 },
  timeline: { height: 56, borderRadius: 8, backgroundColor: C.elevated, marginTop: 6 },
  freezeBand: { position: "absolute", top: 0, bottom: 0, backgroundColor: "rgba(245,158,11,0.22)" },
  lineTouch: { position: "absolute", top: -6, bottom: -6, width: 32, alignItems: "center" },
  line: { flex: 1, borderRadius: 2 },
  lineKnob: { position: "absolute", top: -2, width: 14, height: 14, borderRadius: 7 },
  labelArea: { height: 68, marginTop: 4 },
  timeLabel: { position: "absolute", width: LABEL_WIDTH, textAlign: "center", fontSize: 11, fontWeight: "700" },
  legendRow: { flexDirection: "row", justifyContent: "space-between" },
  legend: { color: C.secondaryText, fontSize: 11 },
  problemBox: { borderRadius: 10, padding: 10, backgroundColor: "rgba(239,68,68,0.12)", gap: 4 },
  problemText: { color: C.danger, fontSize: 12 },
  resultBox: {
    borderRadius: 10,
    padding: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    gap: 4,
  },
  resultTitle: { color: C.text, fontSize: 13, fontWeight: "700" },
  resultText: { fontSize: 12 },
  sectionTitle: { color: C.secondaryText, fontSize: 12, fontWeight: "700", letterSpacing: 1, marginTop: 8 },
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
