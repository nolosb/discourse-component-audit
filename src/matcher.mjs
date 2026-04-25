/**
 * Matches declarations against a component's identity selectors.
 *
 * A resolved selector targets a component if it contains any of the component's
 * identity selectors at a class boundary (preventing .btn from matching .btn-primary).
 */

export function matchDeclarations(declarations, component) {
  const own = [];
  const external = [];
  const primaryFileSet = new Set(component.primaryFiles);
  const matchers = component.identitySelectors.map(buildMatcher);

  for (const decl of declarations) {
    if (!selectorTargetsComponent(decl.selector, matchers)) continue;

    if (primaryFileSet.has(decl.file)) {
      own.push(decl);
    } else {
      external.push(decl);
    }
  }

  return { own, external };
}

export function matchCustomPropertyDefs(declarations, component) {
  if (!component.cssCustomPropertyPrefixes?.length) return [];

  const results = [];
  for (const decl of declarations) {
    if (decl.selector !== ":root" && decl.selector !== ":root-or-global") continue;
    if (!decl.property.startsWith("--")) continue;

    for (const prefix of component.cssCustomPropertyPrefixes) {
      if (decl.property.startsWith(prefix)) {
        results.push(decl);
        break;
      }
    }
  }
  return results;
}

function buildMatcher(identitySelector) {
  const escaped = identitySelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped + "(?=[\\s.#:\\[>+~,)@]|$)");
}

function selectorTargetsComponent(selector, matchers) {
  for (const re of matchers) {
    if (re.test(selector)) return true;
  }
  return false;
}
