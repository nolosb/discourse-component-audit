/**
 * Resolves a nesting chain of SCSS selectors into fully-expanded selector strings.
 *
 * Takes the chain of parent Rule selectors from outermost to innermost and
 * produces all resolved selectors by expanding & references and multiplying
 * comma-separated selector lists.
 */

export function resolveSelector(nestingChain) {
  let current = [""];

  for (const item of nestingChain) {
    if (item.type !== "rule") continue;

    const parts = splitSelectors(item.selector);
    const next = [];

    for (const parent of current) {
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed === "") continue;

        if (trimmed.includes("&")) {
          const resolved = trimmed.replace(/&/g, parent);
          next.push(resolved.trim());
        } else {
          if (parent === "") {
            next.push(trimmed);
          } else {
            next.push(`${parent} ${trimmed}`);
          }
        }
      }
    }

    current = next;
  }

  return current.filter((s) => s.trim() !== "");
}

/**
 * Splits a selector list on commas, respecting parentheses and brackets.
 * Handles selectors like `:not(.a, .b)` and `[attr="a,b"]` without breaking.
 */
function splitSelectors(str) {
  const parts = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inString) {
      current += ch;
      if (ch === stringChar && str[i - 1] !== "\\") {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      current += ch;
    } else if (ch === "(") {
      parenDepth++;
      current += ch;
    } else if (ch === ")") {
      parenDepth--;
      current += ch;
    } else if (ch === "[") {
      bracketDepth++;
      current += ch;
    } else if (ch === "]") {
      bracketDepth--;
      current += ch;
    } else if (ch === "," && parenDepth === 0 && bracketDepth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}
