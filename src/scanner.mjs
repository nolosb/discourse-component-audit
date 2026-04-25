import { resolveSelector } from "./resolver.mjs";
import { classifyValue, concernLevel } from "./classifier.mjs";

export function scanFile(root, relPath) {
  const declarations = [];

  root.walk((node) => {
    if (node.type !== "decl") return;
    if (isInsideMixinDef(node)) return;
    if (isInsideKeyframes(node)) return;
    if (isInsideFunctionDef(node)) return;

    const nestingChain = buildNestingChain(node);
    const resolvedSelectors = resolveSelector(nestingChain);
    const atRuleContext = collectAtRuleContext(node);
    const mixinCalls = collectMixinCalls(node);
    const valueClass = classifyValue(node.value);

    const concern = concernLevel(node.prop, valueClass);

    if (resolvedSelectors.length === 0) {
      declarations.push({
        selector: ":root-or-global",
        property: node.prop,
        value: node.value,
        valueClassification: valueClass,
        concern,
        file: relPath,
        line: node.source?.start?.line ?? 0,
        column: node.source?.start?.column ?? 0,
        atRuleContext,
        mixinCalls,
        important: node.important || false,
      });
      return;
    }

    for (const selector of resolvedSelectors) {
      declarations.push({
        selector,
        property: node.prop,
        value: node.value,
        valueClassification: valueClass,
        concern,
        file: relPath,
        line: node.source?.start?.line ?? 0,
        column: node.source?.start?.column ?? 0,
        atRuleContext,
        mixinCalls,
        important: node.important || false,
      });
    }
  });

  return declarations;
}

function buildNestingChain(node) {
  const chain = [];
  let current = node.parent;
  while (current && current.type !== "root") {
    if (current.type === "rule") {
      chain.unshift({ type: "rule", selector: current.selector });
    } else if (current.type === "atrule") {
      chain.unshift({
        type: "atrule",
        name: current.name,
        params: current.params,
      });
    }
    current = current.parent;
  }
  return chain;
}

function isInsideMixinDef(node) {
  let current = node.parent;
  while (current && current.type !== "root") {
    if (current.type === "atrule" && current.name === "mixin") return true;
    current = current.parent;
  }
  return false;
}

function isInsideKeyframes(node) {
  let current = node.parent;
  while (current && current.type !== "root") {
    if (current.type === "atrule" && current.name === "keyframes") return true;
    current = current.parent;
  }
  return false;
}

function isInsideFunctionDef(node) {
  let current = node.parent;
  while (current && current.type !== "root") {
    if (current.type === "atrule" && current.name === "function") return true;
    current = current.parent;
  }
  return false;
}

function collectAtRuleContext(node) {
  const contexts = [];
  let current = node.parent;
  while (current && current.type !== "root") {
    if (current.type === "atrule") {
      const name = current.name;
      if (["media", "supports", "include", "if", "else", "else if", "for", "each", "while"].includes(name)) {
        contexts.unshift(`@${name} ${current.params ?? ""}`.trim());
      }
    }
    current = current.parent;
  }
  return contexts;
}

function collectMixinCalls(node) {
  const calls = [];
  let current = node.parent;
  while (current && current.type !== "root") {
    if (current.type === "atrule" && current.name === "include") {
      calls.unshift(current.params ?? "");
    }
    current = current.parent;
  }
  return calls;
}
