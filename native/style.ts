// The look of the top bar, rails, drawers, HUD and screens: the browser
// build's style.css, rewritten class-based in tools/ui-style.css and converted
// once with `starhermit css` into assets/ui-style.json (`npm run css`),
// registered at start with the theme the runtime's own widgets (checkboxes,
// selects, scroll bars) take, in the system sans. The colour theme (Settings ›
// Theme: style.css [data-theme] gallery, forest, ocean, sunset, plum) sets the
// tokens, and the runtime's high-contrast option the body.high-contrast ones.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string | number>;
let base: Tokens = {};
/** style.css [data-theme=…] (bg, panel, line, text, muted, accent, btn) plus a lighter hover. */
export const THEME_TOKENS: Record<string, Tokens> = {
  default: { bg: "#2b2f3a", panel: "#343947", line: "#5a6172", text: "#eceef2", muted: "#aab0bd", accent: "#cfa9ff", btn: "#8a4fd0", "btn-hover": "#9a5fe6" },
  forest: { bg: "#2b3a2f", panel: "#34473a", line: "#5a7261", text: "#eceef2", muted: "#aabdc0", accent: "#b7e4c7", btn: "#2d6a4f", "btn-hover": "#367d5d" },
  ocean: { bg: "#2b3547", panel: "#344056", line: "#5a6f8e", text: "#eceef2", muted: "#aabdd1", accent: "#cfe9ff", btn: "#0b6d91", "btn-hover": "#0d7fa9" },
  sunset: { bg: "#473b2b", panel: "#564834", line: "#8e7a5a", text: "#f2eee9", muted: "#cfc0ab", accent: "#ffe1cf", btn: "#a05a2e", "btn-hover": "#b36636" },
  plum: { bg: "#3b2b47", panel: "#463456", line: "#7a5a8e", text: "#efeaf2", muted: "#c9bcd1", accent: "#ffdff0", btn: "#8f3a72", "btn-hover": "#a44485" },
};
/** style.css body.high-contrast. */
const HIGH_CONTRAST: Tokens = { bg: "#000000", panel: "#111111", line: "#ffffff", text: "#ffffff", muted: "#dddddd", accent: "#ffff00", btn: "#005fcc", "btn-hover": "#1a70dd" };

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setFont({ family: "system-ui" });
  ui.setTheme({
    fontSize: 16, smallSize: 14, headingSize: 24, padding: 8, spacing: 8, radius: 6,
    text: "#eceef2", muted: "#aab0bd", panel: "#343947", control: "#2b2f3a", hovered: "#3e4455",
    pressed: "#4a5164", field: "#2b2f3a", accent: "#cfa9ff", focus: "#cfa9ff", outline: "#5a6172",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    // style.css .btn:focus-visible: a 3 px accent outline 1 px out.
    widget: { focusRing: { color: "$accent", width: 3, offset: 1 } },
    checkbox: {
      text: { color: "$text" }, minHeight: 44,
      parts: { box: { background: "$bg", border: { width: 2, color: "$line" }, radius: 4 }, mark: { background: "$accent" } },
    },
    select: { background: "$bg", border: { width: 2, color: "$line" }, radius: 6, text: { color: "$text" }, minHeight: 40 },
    scrollArea: { parts: { bar: { background: "#aab0bd66", radius: 4 } } },
    tooltip: { background: "$panel", text: { color: "$text" }, radius: 6, padding: 6 },
  });
}

let key = "";
/** The theme's colours as the page's tokens (ui.js applyA11yClasses: body[data-theme], body.high-contrast). */
export function applyTheme(theme: string, highContrast: boolean): void {
  const k = highContrast ? "hc" : theme;
  if (k === key) return;
  key = k;
  ui.setTokens({ ...base, ...(highContrast ? HIGH_CONTRAST : THEME_TOKENS[theme] ?? THEME_TOKENS.default!) });
}
