import type { TransitionKind } from "@/types/edit";

/**
 * Transition choices shown everywhere (Edit page panel and My Default), in
 * one place so the lists never drift apart. How each one is rendered lives
 * in services/render/renderPieces.ts (xfadeTransition).
 */
export const TRANSITION_OPTIONS: { kind: TransitionKind; label: string }[] = [
  { kind: "fade", label: "Crossfade" },
  { kind: "dissolve", label: "Random dissolve" },
  { kind: "fadeblack", label: "Fade to black" },
  { kind: "slideleft", label: "Slide left" },
  { kind: "slideright", label: "Slide right" },
  { kind: "wipe", label: "Image wipe" },
  { kind: "checkerboard", label: "Checkerboard" },
  { kind: "snowdrift", label: "Snow drift" },
  { kind: "pixelize", label: "Reconfigure pixel" },
  { kind: "elastic", label: "Elastic wrap" },
];

export const TRANSITION_LABEL = Object.fromEntries(
  TRANSITION_OPTIONS.map((option) => [option.kind, option.label]),
) as Record<TransitionKind, string>;

/** Durations (seconds) users can pick for their own transitions. */
export const TRANSITION_DURATION_CHOICES = [3, 4, 5, 7, 8, 9, 10] as const;
export const DEFAULT_CUSTOM_TRANSITION_DURATION = 3;
