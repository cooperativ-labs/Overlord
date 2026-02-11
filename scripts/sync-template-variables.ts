/**
 * Syncs template variable definitions from the Supabase edge functions
 * (source of truth) to the frontend types.
 *
 * Run with: npx ts-node scripts/sync-template-variables.ts
 * Or add to package.json: "sync:template-vars": "ts-node scripts/sync-template-variables.ts"
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCE_FILE = path.join(
  __dirname,
  '../supabase/functions/_shared/templateVariables.ts'
);
const TARGET_FILE = path.join(__dirname, '../types/messageTemplate.ts');

function extractCategoryVariables(content: string): Record<string, string[]> | null {
  // Extract the CATEGORY_VARIABLES object from the source
  const match = content.match(
    /export const CATEGORY_VARIABLES[^=]*=\s*(\{[\s\S]*?\n\});/
  );
  if (!match) return null;

  const objectStr = match[1];
  const result: Record<string, string[]> = {};

  // Parse each category
  const categoryRegex = /(\w+):\s*\[([\s\S]*?)\]/g;
  let categoryMatch;

  while ((categoryMatch = categoryRegex.exec(objectStr)) !== null) {
    const category = categoryMatch[1];
    const variablesStr = categoryMatch[2];
    const variables = variablesStr
      .match(/'([^']+)'/g)
      ?.map(v => v.replace(/'/g, '')) || [];
    result[category] = variables;
  }

  return result;
}

function updateTargetFile(
  targetContent: string,
  categoryVariables: Record<string, string[]>
): string {
  // Build the new CATEGORY_VARIABLES definition
  const entries = Object.entries(categoryVariables)
    .map(([category, variables]) => {
      const varsFormatted = variables.map(v => `    '${v}'`).join(',\n');
      return `  ${category}: [\n${varsFormatted}\n  ]`;
    })
    .join(',\n');

  const newDefinition = `export const CATEGORY_VARIABLES: Record<MessageCategory, TemplateVariable[]> = {\n${entries}\n};`;

  // Replace the existing CATEGORY_VARIABLES in the target file
  const regex =
    /export const CATEGORY_VARIABLES: Record<MessageCategory, TemplateVariable\[\]> = \{[\s\S]*?\n\};/;

  if (!regex.test(targetContent)) {
    console.error('Could not find CATEGORY_VARIABLES in target file');
    process.exit(1);
  }

  return targetContent.replace(regex, newDefinition);
}

function main() {
  console.log('Syncing template variables...');
  console.log(`Source: ${SOURCE_FILE}`);
  console.log(`Target: ${TARGET_FILE}`);

  // Read source file
  const sourceContent = fs.readFileSync(SOURCE_FILE, 'utf-8');
  const categoryVariables = extractCategoryVariables(sourceContent);

  if (!categoryVariables) {
    console.error('Could not extract CATEGORY_VARIABLES from source file');
    process.exit(1);
  }

  console.log('\nExtracted categories:', Object.keys(categoryVariables));

  // Read and update target file
  const targetContent = fs.readFileSync(TARGET_FILE, 'utf-8');
  const updatedContent = updateTargetFile(targetContent, categoryVariables);

  // Write updated content
  fs.writeFileSync(TARGET_FILE, updatedContent);

  console.log('\nSync complete! Updated types/messageTemplate.ts');
}

main();
