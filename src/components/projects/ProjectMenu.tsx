import { MovieCapColors as C } from "@/constants/theme";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";

/** Where the ⋮ button is on screen (from measureInWindow). */
export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ProjectMenuProps {
  visible: boolean;
  anchor: MenuAnchor | null;
  onRename: () => void;
  onDelete: () => void;
  /** Called when the user taps anywhere outside the menu. */
  onClose: () => void;
}

const MENU_WIDTH = 150;
const MENU_HEIGHT = 98;
const SCREEN_MARGIN = 8;

/**
 * Rename / Delete popup. It is drawn in a transparent full-screen layer, so
 * a tap ANYWHERE outside it closes it (and doesn't also press what's under
 * it). Opens below the ⋮ button, or above it near the bottom of the screen.
 */
export default function ProjectMenu({
  visible,
  anchor,
  onRename,
  onDelete,
  onClose,
}: ProjectMenuProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  if (!visible || !anchor) return null;

  const left = Math.max(
    SCREEN_MARGIN,
    Math.min(anchor.x + anchor.width - MENU_WIDTH, screenWidth - MENU_WIDTH - SCREEN_MARGIN),
  );
  const below = anchor.y + anchor.height + 4;
  const top =
    below + MENU_HEIGHT > screenHeight - SCREEN_MARGIN
      ? Math.max(SCREEN_MARGIN, anchor.y - MENU_HEIGHT - 4)
      : below;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      {/* Full-screen backdrop: any tap outside the menu closes it. */}
      <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu">
        <View
          // Taps on the menu itself must not reach the backdrop.
          onStartShouldSetResponder={() => true}
          style={{
            position: "absolute",
            top,
            left,
            width: MENU_WIDTH,
            backgroundColor: C.card,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 12,
            paddingVertical: 6,
            elevation: 8,
          }}
        >
          <Pressable onPress={onRename} style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
            <Text style={{ color: C.text, fontSize: 14 }}>Rename</Text>
          </Pressable>

          <View style={{ height: 1, backgroundColor: C.border }} />

          <Pressable onPress={onDelete} style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
            <Text style={{ color: C.danger, fontSize: 14 }}>Delete</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
