import { writeFile, mkdir } from "fs/promises";
import { resolve } from "path";

export async function generateReports(component, own, external, customPropDefs, outputDir) {
  await mkdir(outputDir, { recursive: true });

  const summary = buildSummary(own, external, customPropDefs);
  const jsonReport = {
    component: {
      name: component.name,
      slug: component.slug,
      primaryFiles: component.primaryFiles,
      identitySelectors: component.identitySelectors,
    },
    generatedAt: new Date().toISOString(),
    summary,
    own: own.sort(byFileAndLine),
    external: external.sort(byFileAndLine),
    customPropertyDefinitions: customPropDefs.sort(byFileAndLine),
  };

  await writeFile(
    resolve(outputDir, `${component.slug}.json`),
    JSON.stringify(jsonReport, null, 2)
  );

  const html = renderComponentHTML(component, summary, own, external, customPropDefs);
  await writeFile(resolve(outputDir, `${component.slug}.html`), html);

  return summary;
}

export async function generateIndex(components, summaries, outputDir) {
  const html = renderIndexHTML(components, summaries);
  await writeFile(resolve(outputDir, "index.html"), html);
}

function byFileAndLine(a, b) {
  if (a.file < b.file) return -1;
  if (a.file > b.file) return 1;
  return a.line - b.line;
}

function buildSummary(own, external, customPropDefs) {
  const all = [...own, ...external];
  const valueBreakdown = {};
  for (const d of all) {
    const p = d.valueClassification.primary;
    valueBreakdown[p] = (valueBreakdown[p] || 0) + 1;
  }

  const propCounts = {};
  for (const d of external) {
    const key = d.property;
    if (!propCounts[key]) propCounts[key] = { count: 0, files: new Set() };
    propCounts[key].count++;
    propCounts[key].files.add(d.file);
  }
  const mostOverridden = Object.entries(propCounts)
    .map(([property, { count, files }]) => ({ property, count, fileCount: files.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const externalFiles = [...new Set(external.map((d) => d.file))].sort();

  const concernBreakdown = {};
  for (const d of all) {
    concernBreakdown[d.concern] = (concernBreakdown[d.concern] || 0) + 1;
  }

  const existingDefs = new Set();
  for (const d of [...own, ...customPropDefs]) {
    if (d.property.startsWith("--")) existingDefs.add(d.property);
  }

  const STRUCTURAL_FOR_CANDIDATES = new Set([
    "display", "position", "float", "clear", "overflow", "overflow-x", "overflow-y",
    "flex-direction", "flex-wrap", "flex-flow", "flex-grow", "flex-shrink", "flex-basis", "flex",
    "align-items", "align-self", "align-content", "justify-content", "justify-items", "justify-self",
    "order", "box-sizing", "table-layout", "white-space", "pointer-events", "touch-action",
    "user-select", "-webkit-user-select", "cursor", "visibility", "content", "resize",
    "vertical-align", "text-align", "isolation", "will-change", "object-fit",
  ]);

  const candidateProps = {};
  for (const d of external) {
    if (d.property.startsWith("--")) continue;
    if (STRUCTURAL_FOR_CANDIDATES.has(d.property)) continue;
    if (!candidateProps[d.property]) candidateProps[d.property] = { files: new Set(), values: new Set() };
    candidateProps[d.property].files.add(d.file);
    candidateProps[d.property].values.add(d.value);
  }

  const missingCustomProps = Object.entries(candidateProps)
    .filter(([, info]) => info.files.size >= 1)
    .map(([property, info]) => ({
      property,
      fileCount: info.files.size,
      distinctValues: info.values.size,
      hasDef: [...existingDefs].some((def) => def.includes(property.replace(/-/g, "-"))),
    }))
    .sort((a, b) => b.fileCount - a.fileCount);

  const ownThemed = own.filter((d) => !["structural", "definition"].includes(d.concern));
  const ownTokenizedCount = ownThemed.filter((d) => d.concern === "resolved").length;
  const ownScssVarCount = ownThemed.filter((d) => d.concern === "scss-var").length;
  const ownTokenizedPct = ownThemed.length > 0 ? Math.round((ownTokenizedCount / ownThemed.length) * 100) : 100;

  const overriddenPropsList = Object.keys(candidateProps).filter((p) => candidateProps[p].files.size >= 1);
  let totalOverrideWeight = 0;
  let coveredOverrideWeight = 0;
  for (const p of overriddenPropsList) {
    const weight = candidateProps[p].files.size;
    totalOverrideWeight += weight;
    const hasDef = [...existingDefs].some((def) => def.includes(p.replace(/-/g, "-")));
    if (hasDef) coveredOverrideWeight += weight;
  }
  const overrideCoveragePct = totalOverrideWeight > 0 ? Math.round((coveredOverrideWeight / totalOverrideWeight) * 100) : null;
  const overrideCoveredCount = overriddenPropsList.filter((p) => [...existingDefs].some((def) => def.includes(p.replace(/-/g, "-")))).length;
  const overrideTotal = overriddenPropsList.length;

  const actionItems = missingCustomProps.filter((c) => !c.hasDef);

  return {
    totalDeclarations: all.length,
    ownDeclarations: own.length,
    externalDeclarations: external.length,
    customPropertyDefinitions: customPropDefs.length,
    uniqueProperties: new Set(all.map((d) => d.property)).size,
    uniqueSelectors: new Set(all.map((d) => d.selector)).size,
    valueBreakdown,
    concernBreakdown,
    mostOverridden,
    missingCustomProps,
    actionItems,
    existingDefs: [...existingDefs].sort(),
    externalFileCount: externalFiles.length,
    externalFiles,
    ownTokenizedPct,
    ownTokenizedCount,
    ownScssVarCount,
    ownThemedTotal: ownThemed.length,
    overrideCoveragePct,
    overrideCoveredCount,
    overrideTotal,
  };
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function concernBadge(concern) {
  const styles = {
    resolved:     ["#dcfce7", "#166534", "Resolved"],
    "scss-var":   ["#fef3c7", "#92400e", "SCSS var"],
    mixed:        ["#fef9c3", "#854d0e", "Mixed"],
    definition:   ["#f0f9ff", "#0c4a6e", "Definition"],
    hardcoded:    ["#fee2e2", "#991b1b", "Hardcoded"],
    structural:   ["#f3f4f6", "#6b7280", "Structural"],
    review:       ["#dbeafe", "#1e40af", "Review"],
  };
  const [bg, fg, label] = styles[concern] ?? styles.review;
  return `<span class="concern-badge" style="background:${bg};color:${fg}">${label}</span>`;
}

function groupBySelector(decls) {
  const groups = new Map();
  for (const d of decls) {
    if (!groups.has(d.selector)) groups.set(d.selector, []);
    groups.get(d.selector).push(d);
  }
  return groups;
}

function groupByFile(decls) {
  const groups = new Map();
  for (const d of decls) {
    if (!groups.has(d.file)) groups.set(d.file, []);
    groups.get(d.file).push(d);
  }
  return groups;
}

function contextCell(atRuleContext) {
  if (!atRuleContext.length) return "";
  return atRuleContext.map((c) => `<code class="ctx-code">${esc(c)}</code>`).join(" ");
}

function renderDeclTable(decls, showFile) {
  const rows = decls
    .map(
      (d) => `<tr class="concern-${d.concern}">
    <td class="prop">${esc(d.property)}${d.important ? ' <span class="imp">!important</span>' : ""}</td>
    <td class="val"><code>${esc(d.value)}</code></td>
    <td class="ctx">${contextCell(d.atRuleContext)}</td>
    <td>${concernBadge(d.concern)}</td>
    <td class="file">${showFile ? `${esc(d.file)}:${d.line}` : `:${d.line}`}</td>
  </tr>`
    )
    .join("\n");

  const colgroup = showFile
    ? `<colgroup><col style="width:16%"><col style="width:30%"><col style="width:16%"><col style="width:10%"><col style="width:28%"></colgroup>`
    : `<colgroup><col style="width:18%"><col style="width:36%"><col style="width:18%"><col style="width:10%"><col style="width:18%"></colgroup>`;

  return `<table>
  ${colgroup}
  <thead><tr><th>Property</th><th>Value</th><th>Context</th><th>Status</th><th>${showFile ? "File:Line" : "Line"}</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderComponentHTML(component, summary, own, external, customPropDefs) {
  const ownDefs = own.filter((d) => d.property.startsWith("--"));
  const ownRegular = own.filter((d) => !d.property.startsWith("--"));
  const allDefs = [...ownDefs, ...customPropDefs].sort(byFileAndLine);

  const ownBySelector = groupBySelector(ownRegular);
  const externalByFile = groupByFile(external);

  const ownSections = [...ownBySelector.entries()]
    .map(
      ([sel, decls]) => `
    <div class="selector-group">
      <h4><code>${esc(sel)}</code> <span class="count">${decls.length}</span></h4>
      ${renderDeclTable(decls, false)}
    </div>`
    )
    .join("\n");

  const externalSections = [...externalByFile.entries()]
    .map(([file, decls]) => {
      const bySelector = groupBySelector(decls);
      const inner = [...bySelector.entries()]
        .map(
          ([sel, sDecls]) => `
        <div class="selector-group nested">
          <h5><code>${esc(sel)}</code> <span class="count">${sDecls.length}</span></h5>
          ${renderDeclTable(sDecls, false)}
        </div>`
        )
        .join("\n");
      return `
    <details class="file-group">
      <summary><strong>${esc(file)}</strong> <span class="count">${decls.length} declarations</span></summary>
      ${inner}
    </details>`;
    })
    .join("\n");

  const defsBySelector = groupBySelector(allDefs);
  const defSections = [...defsBySelector.entries()]
    .map(
      ([sel, decls]) => `
    <div class="selector-group">
      <h4><code>${esc(sel)}</code> <span class="count">${decls.length}</span></h4>
      ${renderDeclTable(decls, false)}
    </div>`
    )
    .join("\n");

  const customPropSection = allDefs.length > 0
    ? `<section class="section">
      <h3>Custom Property Definitions <span class="count">${allDefs.length}</span></h3>
      ${defSections}
    </section>`
    : "";


  const concernColors = { resolved: "#16a34a", "scss-var": "#d97706", mixed: "#854d0e", definition: "#0c4a6e", hardcoded: "#dc2626", structural: "#9ca3af", review: "#2563eb" };
  const concernOrder = ["resolved", "scss-var", "mixed", "hardcoded", "review", "structural", "definition"];

  const stackedSegments = concernOrder
    .filter((c) => summary.concernBreakdown[c])
    .map((concern) => {
      const count = summary.concernBreakdown[concern];
      const pct = Math.max(Math.round((count / summary.totalDeclarations) * 100), 2);
      return `<div class="stacked-seg" style="width:${pct}%;background:${concernColors[concern]}" title="${concern}: ${count}"></div>`;
    })
    .join("");

  const stackedLegend = concernOrder
    .filter((c) => summary.concernBreakdown[c])
    .map((concern) => {
      const count = summary.concernBreakdown[concern];
      return `<span class="legend-item"><span class="legend-dot" style="background:${concernColors[concern]}"></span>${concern} ${count}</span>`;
    })
    .join("");

  const actionRows = summary.actionItems
    .slice(0, 10)
    .map((c) => `<tr><td class="prop">${esc(c.property)}</td><td>${c.fileCount} files</td><td>${c.distinctValues}</td></tr>`)
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(component.name)} — Style Audit</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; color: #111827; background: #f5f5f7; margin: 0; padding: 40px; max-width: 1200px; margin: 0 auto; }
    code { font-family: "SF Mono", ui-monospace, monospace; font-size: 12px; }
    a { color: #2563eb; }

    .header { background: #fff; border-radius: 12px; padding: 24px 28px; margin-bottom: 24px; border: 1px solid #e5e7eb; }
    .header h1 { margin: 0 0 8px; font-size: 22px; }
    .meta { color: #6b7280; font-size: 13px; margin: 0; }
    .scorecard { padding-bottom: 24px; margin-bottom: 24px; border-bottom: 1px solid #f3f4f6; }
    .dual-scores { display: flex; gap: 48px; margin-bottom: 20px; }
    .score-block { flex: 1; }
    .score-headline { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
    .score-pct { font-size: 36px; font-weight: 800; letter-spacing: -1px; }
    .score-label { font-size: 14px; color: #6b7280; }
    .score-detail { font-size: 12px; color: #9ca3af; }
    .stacked-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin-bottom: 8px; gap: 1px; }
    .stacked-seg { min-width: 3px; }
    .stacked-legend { display: flex; flex-wrap: wrap; gap: 12px; }
    .legend-item { font-size: 11px; color: #6b7280; display: flex; align-items: center; gap: 4px; }
    .legend-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

    .scope-line { font-size: 12px; color: #6b7280; margin: 14px 0 0; }
    .scope-line strong { color: #374151; font-weight: 600; }
    .scope-line span { margin: 0 6px; color: #d1d5db; }
    .analysis-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; align-items: start; }
    .analysis-col h4 { margin: 0 0 10px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; display: flex; align-items: center; gap: 6px; }
    .action-count { font-size: 12px; color: #dc2626; font-weight: 600; }
    .analysis-note { font-size: 12px; color: #9ca3af; margin: 0 0 10px; }

    .section { background: #fff; border-radius: 12px; padding: 24px 28px; margin-bottom: 24px; border: 1px solid #e5e7eb; }
    .section h3 { margin: 0 0 16px; font-size: 16px; }

    .selector-group { margin-bottom: 20px; }
    .selector-group h4, .selector-group h5 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
    .selector-group.nested { margin-left: 16px; }
    .count { font-size: 11px; color: #9ca3af; font-weight: 400; }

    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; table-layout: fixed; }
    th { text-align: left; padding: 5px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; border-bottom: 2px solid #f3f4f6; }
    td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; overflow: hidden; text-overflow: ellipsis; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }
    .prop { font-weight: 500; color: #374151; white-space: nowrap; }
    .val code { color: #4b5563; word-break: break-all; }
    .file { font-family: monospace; font-size: 11px; color: #6b7280; white-space: nowrap; }
    .ctx code { font-size: 10px; background: #f3f4f6; padding: 1px 4px; border-radius: 2px; }
    .imp { font-size: 9px; color: #dc2626; font-weight: 700; }
    .ctx { font-size: 11px; color: #6b7280; }
    .ctx-code { font-size: 10px; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; color: #6b7280; }
    .concern-badge { font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
    tr.concern-structural { opacity: 0.55; }
    tr.concern-definition { opacity: 0.7; }
    .overrides-table { table-layout: auto; }

    .file-group { margin-bottom: 8px; }
    .file-group summary { cursor: pointer; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
    .file-group summary:hover { color: #2563eb; }

    .overrides-table th { text-align: left; }

    .collapsible { background: #fff; border-radius: 12px; margin-bottom: 24px; border: 1px solid #e5e7eb; }
    .collapsible > summary { padding: 16px 28px; cursor: pointer; font-size: 16px; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 8px; }
    .collapsible > summary::-webkit-details-marker { display: none; }
    .collapsible > summary::before { content: "▶"; font-size: 10px; color: #9ca3af; transition: transform 0.15s; }
    .collapsible[open] > summary::before { transform: rotate(90deg); }
    .collapsible > summary:hover { color: #2563eb; }
    .collapsible-body { padding: 0 28px 24px; }
    .collapsible-body .sub-section { margin-bottom: 24px; }
    .collapsible-body .sub-section:last-child { margin-bottom: 0; }
    .collapsible-body h4 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
    .collapsible-body .section { background: none; border: none; border-radius: 0; padding: 0; margin-bottom: 0; }
  </style>
</head>
<body>
  <p style="margin:0 0 12px"><a href="index.html" style="font-size:13px;color:#6b7280;text-decoration:none">&larr; All components</a></p>
  <div class="header">
    <h1>${esc(component.name)} <span style="color:#6b7280;font-weight:400;font-size:16px">Style Audit</span></h1>
    <p class="meta">${component.primaryFiles.map((f) => `<code>${esc(f)}</code>`).join(", ")} &middot; ${component.identitySelectors.length} selectors</p>
  </div>

  <details class="collapsible" open>
    <summary>Analysis <span class="count">${summary.ownTokenizedPct}% own${summary.overrideCoveragePct !== null ? ` &middot; ${summary.overrideCoveragePct}% coverage` : ""}</span></summary>
    <div class="collapsible-body">
      <div class="scorecard">
        <div class="dual-scores">
          <div class="score-block">
            <div class="score-headline">
              <span class="score-pct" style="color:${summary.ownTokenizedPct >= 60 ? "#16a34a" : summary.ownTokenizedPct >= 30 ? "#854d0e" : "#dc2626"}">${summary.ownTokenizedPct}%</span>
              <span class="score-label">own tokenized</span>
            </div>
            <span class="score-detail">${summary.ownTokenizedCount} of ${summary.ownThemedTotal} own declarations use CSS custom properties${summary.ownScssVarCount ? ` &middot; ${summary.ownScssVarCount} use SCSS vars (need migration)` : ""}</span>
          </div>
          <div class="score-block">
            <div class="score-headline">
              ${summary.overrideCoveragePct !== null
                ? `<span class="score-pct" style="color:${summary.overrideCoveragePct >= 60 ? "#16a34a" : summary.overrideCoveragePct >= 30 ? "#854d0e" : "#dc2626"}">${summary.overrideCoveragePct}%</span>`
                : `<span class="score-pct" style="color:#9ca3af">N/A</span>`}
              <span class="score-label">override coverage</span>
            </div>
            ${summary.overrideCoveragePct !== null
              ? `<span class="score-detail">${summary.overrideCoveredCount} of ${summary.overrideTotal} overridden properties have custom prop definitions</span>`
              : `<span class="score-detail">No themeable properties overridden externally</span>`}
          </div>
        </div>
        <div class="stacked-bar">${stackedSegments}</div>
        <div class="stacked-legend">${stackedLegend}</div>
        <p class="scope-line"><strong>${summary.totalDeclarations}</strong> declarations (${summary.ownDeclarations} own + ${summary.externalDeclarations} external)<span>&middot;</span><strong>${summary.uniqueProperties}</strong> properties<span>&middot;</span><strong>${summary.externalFileCount}</strong> external files<span>&middot;</span><strong>${summary.existingDefs.length}</strong> custom props defined</p>
      </div>

      <div class="analysis-columns">
        <div class="analysis-col">
          <h4>Most Overridden</h4>
          ${summary.mostOverridden.length
            ? `<table class="overrides-table"><thead><tr><th>Property</th><th>Count</th><th>Files</th></tr></thead><tbody>${summary.mostOverridden.slice(0, 10).map((o) => `<tr><td class="prop">${esc(o.property)}</td><td>${o.count}</td><td>${o.fileCount}</td></tr>`).join("")}</tbody></table>`
            : `<p class="analysis-note">No external overrides.</p>`}
        </div>
        <div class="analysis-col">
          ${actionRows ? `
            <h4><span class="action-count">${summary.actionItems.length}</span> Missing Custom Properties</h4>
            <table class="overrides-table"><thead><tr><th>Property</th><th>Files</th><th>Values</th></tr></thead><tbody>${actionRows}</tbody></table>
            ${summary.actionItems.length > 10 ? `<p class="analysis-note">+ ${summary.actionItems.length - 10} more</p>` : ""}
          ` : `<h4>Missing Custom Properties</h4><p class="analysis-note" style="color:#16a34a">All overridden properties have custom prop definitions.</p>`}
        </div>
      </div>

      ${allDefs.length ? `<div class="sub-section" style="margin-top:24px">${customPropSection}</div>` : ""}
    </div>
  </details>

  <details class="collapsible">
    <summary>Own Declarations <span class="count">${ownRegular.length}</span></summary>
    <div class="collapsible-body">
      ${ownSections || "<p style='color:#9ca3af'>No own declarations found.</p>"}
    </div>
  </details>

  <details class="collapsible">
    <summary>External Declarations <span class="count">${summary.externalDeclarations} from ${summary.externalFileCount} files</span></summary>
    <div class="collapsible-body">
      ${externalSections || "<p style='color:#9ca3af'>No external declarations found.</p>"}
    </div>
  </details>
</body>
</html>`;
}

function renderIndexHTML(components, summaries) {
  const date = new Date().toISOString().split("T")[0];
  const totalOwn = summaries.reduce((n, s) => n + s.ownDeclarations, 0);
  const totalExt = summaries.reduce((n, s) => n + s.externalDeclarations, 0);
  const avgOwn = summaries.length ? Math.round(summaries.reduce((n, s) => n + s.ownTokenizedPct, 0) / summaries.length) : 0;
  const coverageSummaries = summaries.filter((s) => s.overrideCoveragePct !== null);
  const avgCoverage = coverageSummaries.length ? Math.round(coverageSummaries.reduce((n, s) => n + s.overrideCoveragePct, 0) / coverageSummaries.length) : null;

  const concernColors = { resolved: "#16a34a", "scss-var": "#d97706", mixed: "#854d0e", hardcoded: "#dc2626", review: "#2563eb", structural: "#d1d5db", definition: "#93c5fd" };
  const concernOrder = ["resolved", "scss-var", "mixed", "hardcoded", "review", "structural", "definition"];

  const pctColor = (v) => v >= 60 ? "#16a34a" : v >= 30 ? "#854d0e" : "#dc2626";

  const rows = components
    .map((c, i) => {
      const s = summaries[i];
      const miniBar = concernOrder
        .filter((k) => s.concernBreakdown[k])
        .map((k) => {
          const pct = Math.max(Math.round((s.concernBreakdown[k] / s.totalDeclarations) * 100), 2);
          return `<div style="width:${pct}%;background:${concernColors[k]};min-width:2px"></div>`;
        })
        .join("");

      return `<tr>
      <td><a href="${esc(c.slug)}.html"><strong>${esc(c.name)}</strong></a></td>
      <td class="num"><span class="pct" style="color:${pctColor(s.ownTokenizedPct)}">${s.ownTokenizedPct}%</span></td>
      <td class="num">${s.overrideCoveragePct !== null ? `<span class="pct" style="color:${pctColor(s.overrideCoveragePct)}">${s.overrideCoveragePct}%</span>` : `<span style="color:#9ca3af">N/A</span>`}</td>
      <td><div class="mini-bar">${miniBar}</div></td>
      <td class="num">${s.ownDeclarations}</td>
      <td class="num">${s.externalDeclarations}</td>
      <td class="num">${s.externalFileCount}</td>
      <td class="num">${s.existingDefs.length}</td>
      <td class="num action">${s.actionItems.length || '<span style="color:#16a34a">0</span>'}</td>
    </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discourse Component Style Audit</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; color: #111827; background: #f5f5f7; margin: 0; padding: 40px; max-width: 1200px; margin: 0 auto; }
    code { font-family: "SF Mono", ui-monospace, monospace; font-size: 12px; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }

    .header { background: #fff; border-radius: 12px; padding: 28px 32px; margin-bottom: 24px; border: 1px solid #e5e7eb; }
    .header h1 { margin: 0 0 6px; font-size: 22px; }
    .header-stats { display: flex; gap: 24px; color: #6b7280; font-size: 13px; margin: 0; }
    .header-stats strong { color: #374151; }

    .card { background: #fff; border-radius: 12px; padding: 8px 0; border: 1px solid #e5e7eb; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
    th { text-align: left; padding: 10px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; border-bottom: 2px solid #f3f4f6; white-space: nowrap; cursor: pointer; user-select: none; }
    th:hover { color: #374151; }
    th.r { text-align: right; }
    th .sort-arrow { font-size: 9px; margin-left: 3px; opacity: 0.4; }
    th.sorted .sort-arrow { opacity: 1; color: #2563eb; }
    td { padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; color: #374151; }
    td.action { color: #dc2626; font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }

    .pct { font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; display: inline-block; text-align: right; }
    .mini-bar { display: flex; height: 4px; border-radius: 2px; overflow: hidden; gap: 1px; }

    .legend { display: flex; gap: 14px; padding: 12px 16px 4px; }
    .legend-item { font-size: 11px; color: #6b7280; display: flex; align-items: center; gap: 4px; }
    .legend-dot { width: 8px; height: 8px; border-radius: 2px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Discourse Component Style Audit</h1>
    <p class="header-stats">
      <span>Generated <strong>${date}</strong></span>
      <span><strong>${components.length}</strong> components</span>
      <span><strong>${totalOwn + totalExt}</strong> declarations (${totalOwn} own + ${totalExt} ext)</span>
      <span>Avg own <strong style="color:${pctColor(avgOwn)}">${avgOwn}%</strong></span>
      ${avgCoverage !== null ? `<span>Avg coverage <strong style="color:${pctColor(avgCoverage)}">${avgCoverage}%</strong></span>` : ""}
    </p>
  </div>
  <div class="card">
    <table>
      <colgroup>
        <col style="width:16%">
        <col style="width:8%">
        <col style="width:8%">
        <col style="width:18%">
        <col style="width:8%">
        <col style="width:8%">
        <col style="width:8%">
        <col style="width:10%">
        <col style="width:8%">
      </colgroup>
      <thead><tr>
        <th data-sort="text">Component<span class="sort-arrow"></span></th>
        <th class="r" data-sort="num">Own Tok.<span class="sort-arrow"></span></th>
        <th class="r" data-sort="num">Ovr. Cov.<span class="sort-arrow"></span></th>
        <th>Breakdown</th>
        <th class="r" data-sort="num">Own<span class="sort-arrow"></span></th>
        <th class="r" data-sort="num">External<span class="sort-arrow"></span></th>
        <th class="r" data-sort="num">Ext Files<span class="sort-arrow"></span></th>
        <th class="r" data-sort="num">Cust. Props<span class="sort-arrow"></span></th>
        <th class="r" data-sort="num">Missing<span class="sort-arrow"></span></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="legend">
      ${concernOrder.map((k) => `<span class="legend-item"><span class="legend-dot" style="background:${concernColors[k]}"></span>${k}</span>`).join("")}
    </div>
  </div>
  <script>
    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const table = th.closest('table');
        const tbody = table.querySelector('tbody');
        const idx = [...th.parentNode.children].indexOf(th);
        const type = th.dataset.sort;
        const asc = th.classList.contains('sorted') && th.dataset.dir === 'asc' ? false : true;

        table.querySelectorAll('th').forEach(h => { h.classList.remove('sorted'); h.dataset.dir = ''; });
        th.classList.add('sorted');
        th.dataset.dir = asc ? 'asc' : 'desc';
        th.querySelector('.sort-arrow').textContent = asc ? ' ▲' : ' ▼';
        table.querySelectorAll('th:not(.sorted) .sort-arrow').forEach(a => a.textContent = '');

        const rows = [...tbody.querySelectorAll('tr')];
        rows.sort((a, b) => {
          const aCell = a.children[idx];
          const bCell = b.children[idx];
          let aVal, bVal;
          if (type === 'num') {
            aVal = parseFloat(aCell.textContent.replace(/[^0-9.-]/g, ''));
            bVal = parseFloat(bCell.textContent.replace(/[^0-9.-]/g, ''));
            if (isNaN(aVal)) aVal = -1;
            if (isNaN(bVal)) bVal = -1;
          } else {
            aVal = aCell.textContent.trim().toLowerCase();
            bVal = bCell.textContent.trim().toLowerCase();
          }
          if (aVal < bVal) return asc ? -1 : 1;
          if (aVal > bVal) return asc ? 1 : -1;
          return 0;
        });
        rows.forEach(r => tbody.appendChild(r));
      });
    });
  </script>
</body>
</html>`;
}
