// APP_CONFIG: Shared configuration for visualization settings
// This module provides default settings that both the UI and VIZ modules can use.
// Only the keys you provide will override the internal defaults in viz.js and ui.js.

window.APP_CONFIG = {
  // Layout and metrics
  LAYOUT: "dagre",             // "dagre" | "branched" | "linear"
  MAIN_METRIC: "emp",          // "emp" | "model" | "prob"
  PACKING_METRIC: "emp",       // packing selector used in linear layout
  PROB_DISPLAY: "mean_sd",     // "mean" | "mean_sd" | "range"

  // Geometry & spacing
  GAP_X: 400,                  // px between depths
  ALT_GAP: 45,                 // px between alternates
  PAD_T: 10,                   // box padding top px
  PAD_B: 10,                   // box padding bottom px
  PAD_X: 10,                   // box padding left/right px
  LABEL_MAX: 520,              // label max width px

  // Fonts
  TOKEN_FPX: 16,               // token font px
  META_FPX: 12,                // meta font px

  // Colors
  COLOR_FLOOR: 0.02,           // color floor probability
  COLOR_CAP: 0.60,             // color cap probability

  // Theme
  THEME: "auto",               // "light" | "dark" | "auto"

  // Lines and constraints (not exposed in UI yet, but supported)
  LINK_PX: 1.6,                // link stroke width
  BRANCHED_GAP_MAX: 700,
  ANG_MAX_DEG: 60,             // maximum edge angle to prevent near-vertical links

  // Ghost nodes
  SHOW_PREDICTED_PATHS: true   // show predicted paths (ghost nodes) in all layouts
  // Legacy settings (deprecated - use SHOW_PREDICTED_PATHS instead)
  // SHOW_SYNTH_GHOSTS: true,     // show synthetic model-prediction ghosts in linear layout
  // SHOW_GHOSTS_LINEAR: true     // show ghost tokens in linear layout
};
