import { MovieCapColors as C } from "@/constants/theme";
import { StyleSheet } from "react-native";

export const projectsStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: C.background,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 30,
  },
  title: {
    color: C.text,
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    color: C.secondaryText,
    fontSize: 13,
    marginTop: 7,
  },
  countBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: {
    color: C.text,
    fontSize: 15,
    fontWeight: "600",
  },
  newProjectCard: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 34,
  },
  plusIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  plusText: {
    color: C.text,
    fontSize: 30,
    fontWeight: "300",
  },
  newProjectInfo: {
    flex: 1,
    marginLeft: 14,
  },
  newProjectTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: "600",
  },
  newProjectDescription: {
    color: C.secondaryText,
    fontSize: 12,
    marginTop: 5,
  },
  arrow: {
    color: C.secondaryText,
    fontSize: 28,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  sectionTitle: {
    color: C.text,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  sortText: {
    color: C.secondaryText,
    fontSize: 12,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 45,
    paddingHorizontal: 25,
  },
  emptyIcon: {
    width: 90,
    height: 90,
    borderRadius: 28,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  folderIcon: {
    color: C.primaryLight,
    fontSize: 55,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
  },
  emptyDescription: {
    color: C.secondaryText,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 280,
  },
  storageCard: {
    backgroundColor: C.card,
    borderRadius: 15,
    padding: 17,
    marginTop: 20,
  },
  storageTitle: {
    color: C.secondaryText,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.3,
  },
  storageDescription: {
    color: C.text,
    fontSize: 12,
    marginTop: 10,
  },
  storageStatus: {
    color: C.primaryLight,
    fontSize: 12,
    marginTop: 8,
  },
});
