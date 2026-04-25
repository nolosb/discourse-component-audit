import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { readFile, readdir, mkdir } from "fs/promises";
import { glob } from "glob";
import { parse as parseScss } from "postcss-scss";
import { scanFile } from "./scanner.mjs";
import { matchDeclarations, matchCustomPropertyDefs } from "./matcher.mjs";
import { generateReports, generateIndex } from "./reporter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  let componentFilter = null;
  let discoursePath = resolve(ROOT, "../discourse");
  let outputDir = resolve(ROOT, "dist");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--component" && args[i + 1]) {
      componentFilter = args[++i];
    } else if (args[i] === "--discourse-path" && args[i + 1]) {
      discoursePath = resolve(args[++i]);
    } else if (args[i] === "--output" && args[i + 1]) {
      outputDir = resolve(args[++i]);
    }
  }

  return { componentFilter, discoursePath, outputDir };
}

async function loadComponents(componentDir, filter) {
  const files = await readdir(componentDir);
  const components = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(await readFile(resolve(componentDir, file), "utf-8"));
    if (filter && data.slug !== filter && data.name !== filter) continue;
    components.push(data);
  }
  return components;
}

async function parseAllScss(stylesheetsRoot) {
  const files = await glob("**/*.scss", { cwd: stylesheetsRoot });
  console.log(`  Found ${files.length} SCSS files`);

  const results = [];
  let parseErrors = 0;

  for (const relPath of files) {
    const absPath = resolve(stylesheetsRoot, relPath);
    const content = await readFile(absPath, "utf-8");
    try {
      const root = parseScss(content, { from: absPath });
      results.push({ relPath, root });
    } catch (e) {
      parseErrors++;
      if (parseErrors <= 5) {
        console.warn(`  Warning: parse error in ${relPath}: ${e.message}`);
      }
    }
  }

  if (parseErrors > 5) {
    console.warn(`  ... and ${parseErrors - 5} more parse errors`);
  }

  return results;
}

async function main() {
  const { componentFilter, discoursePath, outputDir } = parseArgs();
  const componentDir = resolve(ROOT, "components");
  const stylesheetsRoot = resolve(discoursePath, "app/assets/stylesheets");

  console.log(`Discourse path: ${discoursePath}`);
  console.log(`Stylesheets:    ${stylesheetsRoot}`);
  console.log(`Output:         ${outputDir}`);
  console.log();

  const components = await loadComponents(componentDir, componentFilter);
  if (components.length === 0) {
    console.error(`No components found${componentFilter ? ` matching "${componentFilter}"` : ""}`);
    process.exit(1);
  }
  console.log(`Components: ${components.map((c) => c.name).join(", ")}`);

  console.log("\nParsing SCSS...");
  const parsedFiles = await parseAllScss(stylesheetsRoot);

  console.log("Scanning declarations...");
  const allDeclarations = [];
  for (const { relPath, root } of parsedFiles) {
    const decls = scanFile(root, relPath);
    allDeclarations.push(...decls);
  }
  console.log(`  ${allDeclarations.length} total declarations extracted\n`);

  await mkdir(outputDir, { recursive: true });
  const summaries = [];

  for (const component of components) {
    console.log(`Auditing ${component.name}...`);
    const { own, external } = matchDeclarations(allDeclarations, component);
    const customPropDefs = matchCustomPropertyDefs(allDeclarations, component);

    const summary = await generateReports(component, own, external, customPropDefs, outputDir);
    summaries.push(summary);

    const bar = "█".repeat(Math.round((own.length / (own.length + external.length || 1)) * 20));
    const empty = "░".repeat(20 - bar.length);
    console.log(`  ${bar}${empty}  ${own.length} own + ${external.length} external + ${customPropDefs.length} :root defs`);
    console.log(`  ${summary.externalFileCount} external files, ${summary.uniqueProperties} unique properties`);
  }

  await generateIndex(components, summaries, outputDir);
  console.log(`\nDone. Reports in ${relative(process.cwd(), outputDir)}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
