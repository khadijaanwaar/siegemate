/**
 * The headset panels' look: the same calm palette as the 2D interface, tuned
 * for passthrough (never pure black or white; text stays readable over a bright
 * room because every panel carries its own dark glass).
 */
export const UI = {
  glass: "rgba(21, 23, 28, 0.88)",
  surface: "#1E2128",
  surfaceHover: "#2A2E37",
  line: "#2E323B",
  text: "#EEE8DA",
  muted: "#A9A396",
  gold: "#E0B75A",
  goldText: "#15171C",
  azure: "#6EA8FF",
  ember: "#FF6A55",
  danger: "#E5574B",
  /** Inter when it is loaded, else the platform sans; never italic (Meta: no italics in XR). */
  font: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  display: "Cinzel, Georgia, serif",
} as const;
