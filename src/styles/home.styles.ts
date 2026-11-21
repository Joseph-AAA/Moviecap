import { MovieCapColors as C } from "@/constants/theme";
import { StyleSheet } from "react-native";

export const homeStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.background,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    width: 0,
    height: 0,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#FFFFFF",
    marginLeft: 3,
  },
  brand: {
    color: C.text,
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  tagline: {
    color: C.secondaryText,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.7,
    marginTop: 3,
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },

  settingsIcon: {
    color: C.secondaryText,
    fontSize: 21,
  },

  profileButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#302443",
    borderWidth: 1,
    borderColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },

  avatarHead: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.primaryLight,
    marginBottom: 2,
  },

  avatarBody: {
    width: 20,
    height: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: C.primaryLight,
  },

  welcome: {
    marginTop: 42,
    marginBottom: 26,
  },
  welcomeTitle: {
    color: C.text,
    fontSize: 31,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  purpleText: {
    color: C.primaryLight,
  },
  description: {
    color: C.secondaryText,
    fontSize: 14,
    marginTop: 12,
    lineHeight: 21,
  },
  newProject: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.primary,
    borderRadius: 18,
    padding: 18,
    marginBottom: 34,
  },
  newProjectIcon: {
    width: 43,
    height: 43,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  plus: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "400",
  },
  newProjectText: {
    flex: 1,
    marginLeft: 14,
  },
  newProjectTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  newProjectSubtitle: {
    color: "#E9DDFF",
    fontSize: 11,
    marginTop: 5,
  },
  arrow: {
    color: "#FFFFFF",
    fontSize: 27,
    fontWeight: "300",
  },
  sectionTitle: {
    color: C.secondaryText,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  dubbingCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 17,
    padding: 16,
    marginTop: 14,
    marginBottom: 34,
  },
  dubbingIcon: {
    width: 47,
    height: 47,
    borderRadius: 14,
    backgroundColor: "#302443",
    alignItems: "center",
    justifyContent: "center",
  },
  toolEmoji: {
    fontSize: 23,
  },
  dubbingInfo: {
    flex: 1,
    marginLeft: 13,
  },
  dubbingTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
  },
  dubbingDescription: {
    color: C.secondaryText,
    fontSize: 11,
    marginTop: 5,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "#263A31",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
    marginTop: 9,
  },
  badgeText: {
    color: "#75D9A0",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  seeAll: {
    color: C.primaryLight,
    fontSize: 12,
    fontWeight: "600",
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    paddingVertical: 28,
    paddingHorizontal: 20,
    marginTop: 15,
  },
  emptyIcon: {
    fontSize: 31,
    marginBottom: 12,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "700",
  },
  emptyDescription: {
    color: C.secondaryText,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 7,
  },
});
