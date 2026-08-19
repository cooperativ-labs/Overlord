import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = ['backend', 'packages'];
const ignored =
  /(?:^|\/)(?:dist-server|test|tests)(?:\/|$)|\.test\.[cm]?[jt]sx?$|secondary-workspace-fixture\.ts$/;

const allowedFiles = new Set([
  // Accessor definitions, request-context binding and explicit active-edge helpers.
  'backend/db.ts'
]);

// Contract v95 retires every production ambient read. The only surviving
// compatibility definitions live in backend/db.ts and are process-local for
// bootstrap/direct-service tests; new call sites must never be allowlisted.
const allowed = [];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (ignored.test(file)) return [];
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}

function functionName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText();
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    if (ts.isFunctionLike(current)) {
      for (let parent = current.parent; parent; parent = parent.parent) {
        if (
          ts.isCallExpression(parent) &&
          ts.isPropertyAccessExpression(parent.expression) &&
          ts.isIdentifier(parent.expression.expression) &&
          ['app', 'router'].includes(parent.expression.expression.text) &&
          ['get', 'post', 'put', 'patch', 'delete'].includes(parent.expression.name.text) &&
          ts.isStringLiteral(parent.arguments[0])
        ) {
          return `${parent.expression.name.text.toUpperCase()} ${parent.arguments[0].text}`;
        }
      }
    }
  }
  return '<module>';
}

function ambientExpression(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    ['getActiveWorkspace', 'getActiveWorkspaceId', 'getActiveWorkspaceIdOrNull'].includes(
      node.expression.text
    )
  ) {
    return node.expression.text;
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'WORKSPACE' &&
    ['id', 'slug', 'name', 'kind'].includes(node.name.text)
  ) {
    return `WORKSPACE.${node.name.text}`;
  }
  return null;
}

const violations = [];
for (const file of roots.flatMap(sourceFiles)) {
  const source = readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = node => {
    const expression = ambientExpression(node);
    if (expression) {
      const scope = functionName(node);
      const approved = allowedFiles.has(file) || allowed.some(
        entry => entry.file === file && entry.scope === scope && entry.expression === expression
      );
      if (!approved) {
        const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        violations.push(`${file}:${line + 1} ${scope} uses ${expression}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

if (violations.length > 0) {
  console.error(
    'Unapproved ambient workspace reads:\n' + violations.map(item => `- ${item}`).join('\n')
  );
  process.exitCode = 1;
} else {
  process.stdout.write('Workspace scoping check passed.\n');
}
