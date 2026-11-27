import { useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";

import { MovieCapColors as C } from "@/constants/theme";
import {
  cutPlacementProblem,
  listTransitionSlots,
  type TransitionSlot,
} from "@/services/timeline/editTimeline";
import {
  DEFAULT_CUSTOM_TRANSITION_DURATION,
  TRANSITION_DURATION_CHOICES,
  TRANSITION_LABEL as KIND_LABEL,
  TRANSITION_OPTIONS as KINDS,
} from "@/constants/transitions";
import type { EditConfig, TransitionKind } from "@/types/edit";

const SOURCE_LABEL: Record<TransitionSlot["source"], string> = {
  custom: "Custom",
  default: "Default",
  "freeze-exit": "Freeze exit",
  none: "Hard cut",
};

function formatTimestamp(seconds: number) {
  const whole = Math.floor(seconds);
  const tenths = Math.floor((seconds - whole) * 10);
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}.${tenths}`;
}

interface TransitionsPanelProps {
  config: EditConfig;
  isBusy: boolean;
  /** Current playhead time (read when "Add at playhead" is pressed). */
  getPlayheadTime: () => number;
  /**
   * Preview a transition exactly as it will be exported. `kind`/`duration`
   * may be unsaved choices from the editor sheet.
   */
  onPreviewTransition: (at: number, kind: TransitionKind, duration: number) => void;
  onSave: (at: number, kind: TransitionKind, duration: number) => void;
  onRemoveCustom: (at: number) => void;
}

interface Draft {
  at: number;
  kind: TransitionKind;
  duration: number;
  slot: TransitionSlot | null;
}

/**
 * Custom transitions: list every cut, edit what plays there, add a cut at
 * the playhead. Custom choices are stored separately from the Default Edit
 * and win at the same cut; removing one restores the default.
 */
export default function TransitionsPanel({
  config,
  isBusy,
  getPlayheadTime,
  onPreviewTransition,
  onSave,
  onRemoveCustom,
}: TransitionsPanelProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const slots = listTransitionSlots(config);

  const openSlot = (slot: TransitionSlot) =>
    setDraft({
      at: slot.at,
      kind: slot.effective?.kind ?? "dissolve",
      duration: slot.effective?.duration ?? DEFAULT_CUSTOM_TRANSITION_DURATION,
      slot,
    });

  const addAtPlayhead = () => {
    const at = getPlayheadTime();
    const problem = cutPlacementProblem(config, at);
    if (problem) {
      Alert.alert("Can't add a transition here", problem);
      return;
    }

    const existing = slots.find((s) => Math.abs(s.at - at) < 0.3);
    if (existing) {
      openSlot(existing);
      return;
    }

    setDraft({ at, kind: "fade", duration: DEFAULT_CUSTOM_TRANSITION_DURATION, slot: null });
  };

  const save = () => {
    if (!draft) return;
    onSave(draft.at, draft.kind, draft.duration);
    setDraft(null);
  };

  const remove = () => {
    if (!draft) return;
    onRemoveCustom(draft.at);
    setDraft(null);
  };

  const isCustom = draft?.slot?.source === "custom";
  const hasDefaultHere = Boolean(draft?.slot?.defaultTransition);

  return (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: C.border,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: C.secondaryText, fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>
          TRANSITIONS
        </Text>
        <Text style={{ color: C.secondaryText, fontSize: 12 }}>
          {slots.length} {slots.length === 1 ? "cut" : "cuts"}
        </Text>
      </View>

      {slots.length === 0 ? (
        <Text style={{ color: C.secondaryText, fontSize: 12 }}>
          No cuts yet. Apply Default, or move the playhead and add a transition.
        </Text>
      ) : (
        slots.map((slot) => (
          <Pressable
            key={`${slot.at}`}
            onPress={() => openSlot(slot)}
            disabled={isBusy}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: C.elevated,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <View style={{ gap: 2 }}>
              <Text style={{ color: C.text, fontSize: 14, fontWeight: "600" }}>
                {formatTimestamp(slot.at)} ·{" "}
                {slot.effective ? KIND_LABEL[slot.effective.kind] : "Cut"}
                {slot.effective ? ` ${slot.effective.duration}s` : ""}
              </Text>
              <Text
                style={{
                  color: slot.source === "custom" ? C.primaryLight : C.secondaryText,
                  fontSize: 11,
                }}
              >
                {SOURCE_LABEL[slot.source]}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              {slot.effective && (
                <Pressable
                  onPress={() =>
                    onPreviewTransition(slot.at, slot.effective!.kind, slot.effective!.duration)
                  }
                  disabled={isBusy}
                  hitSlop={8}
                  accessibilityLabel="Preview this transition"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: C.primary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 12 }}>▶</Text>
                </Pressable>
              )}
              <Text style={{ color: C.secondaryText, fontSize: 18 }}>›</Text>
            </View>
          </Pressable>
        ))
      )}

      <Pressable
        onPress={addAtPlayhead}
        disabled={isBusy}
        style={{
          minHeight: 42,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: C.primary,
          alignItems: "center",
          justifyContent: "center",
          opacity: isBusy ? 0.5 : 1,
        }}
      >
        <Text style={{ color: C.primaryLight, fontSize: 14, fontWeight: "600" }}>
          + Add transition at playhead
        </Text>
      </Pressable>

      <Modal
        visible={draft !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDraft(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "flex-end",
          }}
        >
          {draft && (
            <View
              style={{
                backgroundColor: C.card,
                borderTopLeftRadius: 18,
                borderTopRightRadius: 18,
                padding: 20,
                gap: 14,
                borderWidth: 1,
                borderColor: C.border,
              }}
            >
              <Text style={{ color: C.text, fontSize: 18, fontWeight: "700" }}>
                Transition at {formatTimestamp(draft.at)}
              </Text>

              <Text style={{ color: C.secondaryText, fontSize: 12 }}>
                {draft.slot
                  ? `Now: ${draft.slot.effective ? KIND_LABEL[draft.slot.effective.kind] : "Hard cut"} (${SOURCE_LABEL[draft.slot.source]})`
                  : "New cut at the playhead"}
              </Text>

              <Text style={{ color: C.secondaryText, fontSize: 12, fontWeight: "700" }}>TYPE</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {KINDS.map(({ kind, label }) => (
                  <Chip
                    key={kind}
                    label={label}
                    selected={draft.kind === kind}
                    onPress={() => setDraft({ ...draft, kind })}
                  />
                ))}
              </View>

              <Text style={{ color: C.secondaryText, fontSize: 12, fontWeight: "700" }}>
                DURATION
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {TRANSITION_DURATION_CHOICES.map((duration) => (
                  <Chip
                    key={duration}
                    label={`${duration}s`}
                    selected={draft.duration === duration}
                    onPress={() => setDraft({ ...draft, duration })}
                  />
                ))}
              </View>

              {/* Try the CURRENT choice before saving it. */}
              <Pressable
                onPress={() => onPreviewTransition(draft.at, draft.kind, draft.duration)}
                hitSlop={6}
              >
                <Text style={{ color: C.primaryLight, fontSize: 13 }}>
                  ▶ Preview this transition
                </Text>
              </Pressable>

              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                {isCustom && (
                  <Pressable
                    onPress={remove}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      borderRadius: 10,
                      backgroundColor: C.elevated,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: C.danger, fontWeight: "600" }}>
                      {hasDefaultHere ? "Reset to default" : "Remove cut"}
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  onPress={() => setDraft(null)}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    backgroundColor: C.elevated,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: C.text, fontWeight: "600" }}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={save}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    backgroundColor: C.primary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 18,
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
