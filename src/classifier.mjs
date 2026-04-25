const STRUCTURAL_PROPERTIES = new Set([
  "display", "position", "float", "clear",
  "overflow", "overflow-x", "overflow-y", "overflow-wrap",
  "flex-direction", "flex-wrap", "flex-flow", "flex-grow", "flex-shrink", "flex-basis", "flex",
  "align-items", "align-self", "align-content", "justify-content", "justify-items", "justify-self",
  "order", "place-items", "place-content", "place-self",
  "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-template",
  "grid-column", "grid-row", "grid-area", "grid-auto-flow", "grid-auto-columns", "grid-auto-rows",
  "box-sizing", "table-layout",
  "white-space", "word-break", "word-wrap", "overflow-wrap", "text-overflow", "hyphens",
  "pointer-events", "touch-action", "user-select", "-webkit-user-select",
  "cursor",
  "visibility", "backface-visibility",
  "content",
  "resize",
  "appearance", "-webkit-appearance", "-moz-appearance",
  "list-style", "list-style-type", "list-style-position",
  "vertical-align", "text-align",
  "direction", "unicode-bidi",
  "isolation", "contain", "will-change",
  "object-fit", "object-position",
  "writing-mode", "text-orientation",
  "scroll-behavior", "overscroll-behavior", "overscroll-behavior-x", "overscroll-behavior-y",
  "scroll-snap-type", "scroll-snap-align",
  "column-count", "column-gap", "column-fill",
  "break-inside", "break-before", "break-after", "page-break-inside", "page-break-before", "page-break-after",
  "text-decoration-style", "text-decoration-line",
  "border-collapse", "border-spacing",
  "empty-cells", "caption-side",
  "clip-path",
  "-webkit-overflow-scrolling",
  "-webkit-line-clamp", "-webkit-box-orient",
  "animation-fill-mode", "animation-direction", "animation-iteration-count", "animation-play-state",
]);

const CSS_FUNCTIONS = /(?<![.\w-])(rgb|rgba|hsl|hsla|linear-gradient|radial-gradient|conic-gradient|env|z|dark-light-choose|light-dark|color\.adjust|color\.mix|color\.scale|math\.div|translate[XY3d]?|rotate[XYZ3d]?|scale[XY3d]?|skew[XY]?|matrix|perspective|cubic-bezier|clamp|min|max|minmax|repeat|blur|brightness|contrast|drop-shadow|grayscale|invert|opacity|saturate|sepia|url)\s*\(/;

export function classifyValue(value) {
  const tags = [];
  const trimmed = value.trim();

  if (/\$[\w-]/.test(trimmed)) {
    tags.push("scss-var");
  }

  if (/var\(--[\w-]/.test(trimmed)) {
    tags.push("css-var");
  }

  if (/calc\s*\(/.test(trimmed)) {
    tags.push("calc");
  }

  if (CSS_FUNCTIONS.test(trimmed)) {
    tags.push("function");
  }

  if (/#\{/.test(trimmed)) {
    tags.push("interpolation");
  }

  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
    tags.push("hardcoded-color");
  } else if (/#[0-9a-fA-F]{3,8}/.test(trimmed) && !trimmed.includes("var(") && !trimmed.includes("#{")) {
    tags.push("hardcoded-color");
  }

  if (/\d+(px|em|rem|%|vw|vh|dvh|svh|lvh|vmin|vmax|ch|ex|lh|rlh|cm|mm|in|pt|pc|fr|s|ms)\b/.test(trimmed)) {
    tags.push("hardcoded");
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    tags.push("hardcoded");
  }

  let primary;
  if (tags.includes("scss-var")) primary = "scss-var";
  else if (tags.includes("css-var") && tags.length === 1) primary = "css-var";
  else if (tags.includes("calc")) primary = "calc";
  else if (tags.includes("css-var")) primary = "css-var";
  else if (tags.includes("function")) primary = "function";
  else if (tags.includes("interpolation")) primary = "interpolation";
  else if (tags.includes("hardcoded-color")) primary = "hardcoded-color";
  else if (tags.includes("hardcoded")) primary = "hardcoded";
  else primary = "other";

  return { primary, tags: [...new Set(tags)] };
}

/**
 * Determine the concern level for a declaration based on property + value.
 *
 * - "resolved"   — value uses CSS custom properties (var(--x)). Ready.
 * - "scss-var"   — value uses SCSS variables ($x). Needs migration to CSS custom props.
 * - "mixed"      — variable + hardcoded literal combined. Needs attention.
 * - "hardcoded"  — themeable property with a literal value. Needs attention.
 * - "structural" — property not expected to be redeclared. Fine as-is.
 * - "review"     — calc/function/interpolation. Case-by-case.
 */
export function concernLevel(property, valueClassification) {
  if (property.startsWith("--")) return "definition";

  const hasCssVar = valueClassification.tags.includes("css-var");
  const hasScssVar = valueClassification.tags.includes("scss-var");
  const hasHardcoded = valueClassification.tags.includes("hardcoded") || valueClassification.tags.includes("hardcoded-color");

  if (hasCssVar && hasScssVar) {
    return hasHardcoded ? "mixed" : "scss-var";
  }

  if (hasCssVar) {
    return hasHardcoded ? "mixed" : "resolved";
  }

  if (hasScssVar) {
    return hasHardcoded ? "mixed" : "scss-var";
  }

  if (isStructural(property)) return "structural";

  const p = valueClassification.primary;
  if (p === "calc" || p === "function" || p === "interpolation") return "review";

  return "hardcoded";
}

function isStructural(property) {
  const prop = property.replace(/^--(webkit|moz|ms)-/, "");
  if (STRUCTURAL_PROPERTIES.has(prop)) return true;
  if (prop.startsWith("--")) return false;
  return false;
}
