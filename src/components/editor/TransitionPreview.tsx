import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import ExportPlayerModal from "@/components/editor/ExportPlayerModal";
import { MovieCapColors as C } from "@/constants/theme";
import { TRANSITION_LABEL } from "@/constants/transitions";
import {
  RenderCancelledError,
  renderTransitionPreview,
  type RenderHandle,
} from "@/services/render/renderProject";
import type { EditConfig, TransitionKind } from "@/types/edit";

export interface TransitionPreviewRequest {
  /** Edit to preview (may include an unsaved transition being edited). */
  config: EditConfig;
  at: number;
  kind: TransitionKind;
  duration: number;
}

interface TransitionPreviewProps {
  request: TransitionPreviewRequest;
  onClose: () => void;
}

/**
 * Renders one transition exactly like the export (small and short), then
 * plays it with sound. Shows progress with Cancel while rendering.
 */
export default function TransitionPreview({ request, onClose }: TransitionPreviewProps) {
  const [progress, setProgress] = useState(0);
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<RenderHandle | null>(null);

  useEffect(() => {
    let isActive = true;
    const handle = renderTransitionPreview(request.config, request.at, request.duration, (p) => {
      if (isActive) setProgress(p);
    });
    handleRef.current = handle;

    handle.done
      .then((file) => {
        if (isActive) setUri(file);
      })
      .catch((err) => {
        if (!isActive || err instanceof RenderCancelledError) return;
        console.error("Transition preview failed:", err);
        setError(err instanceof Error ? err.message.slice(0, 200) : "Could not make the preview.");
      });

    return () => {
      isActive = false;
      handle.cancel();
    };
    // One render per request object.
  }, [request]);

  if (uri) {
    return (
      <ExportPlayerModal
        uri={uri}
        title={`${TRANSITION_LABEL[request.kind]} · ${request.duration}s preview`}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.7)",
          justifyContent: "center",
          paddingHorizontal: 28,
        }}
      >
        <View
          style={{
            backgroundColor: C.card,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: C.border,
            padding: 20,
            gap: 12,
          }}
        >
          <Text style={{ color: C.text, fontSize: 17, fontWeight: "700" }}>
            Preview · {TRANSITION_LABEL[request.kind]} {request.duration}s
          </Text>

          {error ? (
            <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text>
          ) : (
            <>
              <Text style={{ color: C.secondaryText, fontSize: 13 }}>
                Making a short preview exactly like the export…
              </Text>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: C.elevated, overflow: "hidden" }}>
                <View
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                    height: "100%",
                    backgroundColor: C.primary,
                  }}
                />
              </View>
              <Text style={{ color: C.text, fontSize: 13 }}>{Math.round(progress * 100)}%</Text>
            </>
          )}

          <Pressable
            onPress={() => {
              handleRef.current?.cancel();
              onClose();
            }}
            style={{
              alignSelf: "flex-end",
              paddingHorizontal: 16,
              paddingVertical: 9,
              borderRadius: 10,
              backgroundColor: C.elevated,
            }}
          >
            <Text style={{ color: C.text, fontWeight: "600" }}>{error ? "Close" : "Cancel"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
