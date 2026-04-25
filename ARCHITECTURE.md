# discourse-component-audit

AST-based SCSS audit tool for Discourse UI kit candidate components. Parses all SCSS files with PostCSS + postcss-scss, resolves nested selectors, and produces a complete inventory of every CSS declaration affecting each component.

## Usage

```bash
npm run audit                                    # all components
node src/index.mjs --component d-button          # single component
node src/index.mjs --discourse-path ../discourse  # custom Discourse path
node src/index.mjs --output ./reports             # custom output dir
```

Reports are generated in `dist/` as HTML + JSON per component, plus an `index.html` overview.

## Component Definitions

Each `components/*.json` file defines a component's identity in the SCSS codebase:

```json
{
  "name": "d-modal",
  "slug": "d-modal",
  "primaryFiles": ["common/base/modal.scss", "common/modal/modal-overrides.scss"],
  "identitySelectors": [".d-modal", ".d-modal__container", ".d-modal__header"],
  "cssCustomPropertyPrefixes": ["--modal-"]
}
```

| Field | Purpose |
|---|---|
| `primaryFiles` | SCSS files that define the component (relative to stylesheets root). Declarations here are **own**. |
| `identitySelectors` | Selectors that identify this component. Rules targeting these from other files are **external**. |
| `cssCustomPropertyPrefixes` | Prefixes for matching `:root` custom property definitions to this component. |

## Pipeline

```
Component JSON
  → Parse all SCSS files (PostCSS + postcss-scss, no compilation)
  → Walk AST: extract every declaration with resolved selector, value classification, context
  → Match resolved selectors against component identity selectors
  → Partition into own vs external
  → Compute analysis metrics
  → Generate HTML + JSON reports
```

## Source Files

| File | Purpose |
|---|---|
| `src/index.mjs` | CLI entry, orchestration |
| `src/scanner.mjs` | PostCSS AST walker — extracts declarations with resolved selectors, at-rule context, mixin calls |
| `src/resolver.mjs` | Resolves nested SCSS selectors (`&` expansion, comma multiplication) |
| `src/classifier.mjs` | Classifies values and determines concern levels |
| `src/matcher.mjs` | Matches resolved selectors to component identity selectors at class boundaries |
| `src/reporter.mjs` | JSON + HTML report generation with analysis metrics |

## Concern Levels

Every declaration gets a concern level based on its property and value:

| Level | Meaning | Action |
|---|---|---|
| **resolved** | Value uses CSS custom properties (`var(--x)`). | Ready. |
| **scss-var** | Value uses SCSS variables (`$x`). | Needs migration to CSS custom properties. |
| **mixed** | Variable + hardcoded literal combined. | Needs attention. |
| **hardcoded** | Themeable property with a literal value. | Needs tokenization. |
| **structural** | Layout/behavior property (display, position, flex-direction, etc.). | Fine as-is. |
| **definition** | CSS custom property being defined (`--x: value`). | Informational. |
| **review** | calc/function/interpolation without variables. | Case-by-case. |

## Analysis Metrics

### Own Tokenized %
Percentage of the component's own themeable declarations that use CSS custom properties. Only `var(--x)` counts — SCSS variables (`$x`) are flagged separately as needing migration.

### Override Coverage %
Percentage of externally overridden themeable properties that have a corresponding custom property definition. Weighted by file count — a property overridden in 20 files contributes more than one overridden in 1 file. Shows N/A when no properties are overridden externally.

## Known Limitations

1. **Mixin injection invisible**: `@include btn(...)` injects properties PostCSS can't see. The report records `@include` calls as context.
2. **SCSS variable values not resolved**: `$vpad` stays as `$vpad`. Intentional — we audit authored state.
3. **Both `@if`/`@else` branches captured**: Both conditional branches appear. Correct for an audit.
4. **`@extend` not expanded**: Inherited properties not duplicated to extending selectors.

## Current Components

badges, d-button, d-icon-grid-picker, d-menu, d-modal, d-segmented-control, d-toggle-switch, nav-pills, topic-map, user-card

## Future: Token Manifests and Enforcement

The audit is step one. The end goal is that each component manifest declares an explicit **tokens** array — the full list of CSS custom properties that external code is allowed to set:

```json
{
  "name": "d-modal",
  "slug": "d-modal",
  "primaryFiles": ["common/base/modal.scss"],
  "identitySelectors": [".d-modal", ".d-modal__container"],
  "cssCustomPropertyPrefixes": ["--modal-"],
  "tokens": [
    "--d-modal-padding-block",
    "--d-modal-padding-inline",
    "--d-modal-border-radius",
    "--d-modal-max-width"
  ]
}
```

Components expose a controlled surface area for customization through tokens. The naming convention is `--d-{component}-{property}`.

### Allowed

External code sets tokens to customize a component in context:

```scss
.topic-list .d-modal {
  --d-modal-padding-block: 0.5rem;
}
```

### Not Allowed

External code must not set concrete CSS properties on component selectors directly:

```scss
.topic-list .d-modal__container {
  padding-block: 0.5rem;  // use --d-modal-padding-block instead
}
```

Direct property overrides bypass the component's API, create invisible coupling, and break when internals change. Tokens give the component author control over what is customizable.

### Enforcement

Planned as a **stylelint plugin** (`ui-kit/no-direct-override`) that:

1. Loads component manifests from `components/*.json`
2. For each external declaration targeting a component's identity selectors, checks whether it sets a property listed in `tokens`
3. Flags everything else as a violation

### Workflow

1. **Audit** — run this tool to see all own and external declarations
2. **Author tokens** — based on the audit, add the right custom properties to the manifest's `tokens` array and the component's SCSS
3. **Enforce** — the stylelint plugin prevents new direct overrides
4. **Re-audit** — as the codebase evolves, re-run to surface new overrides that need tokens or migration
