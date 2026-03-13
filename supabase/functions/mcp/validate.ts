// ---------------------------------------------------------------------------
// Server-side input validation for MCP tool calls
// ---------------------------------------------------------------------------

import { TOOLS } from './tools.ts';

/**
 * Validate tool arguments against the tool's inputSchema.
 * Returns an error message string if validation fails, or null if valid.
 *
 * Checks:
 * - Tool exists
 * - All required fields are present
 * - String fields are strings and within size limits
 * - Number fields are numbers
 * - Enum fields match allowed values
 */
export function validateToolInput(
  toolName: string,
  // deno-lint-ignore no-explicit-any
  args: Record<string, any>
): string | null {
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) return `Unknown tool: ${toolName}`;

  const schema = tool.inputSchema;
  if (!schema || schema.type !== 'object') return null;

  // Check required fields
  const required: string[] = (schema as { required?: string[] }).required ?? [];
  for (const field of required) {
    if (args[field] === undefined || args[field] === null) {
      return `Missing required field: ${field}`;
    }
  }

  // deno-lint-ignore no-explicit-any
  const properties: Record<string, any> = (schema as any).properties ?? {};

  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) continue; // Allow extra fields (forward-compat)

    // Type checks
    if (prop.type === 'string' && typeof value !== 'string') {
      return `Field "${key}" must be a string.`;
    }
    if (prop.type === 'number' && typeof value !== 'number') {
      return `Field "${key}" must be a number.`;
    }
    if (prop.type === 'array' && !Array.isArray(value)) {
      return `Field "${key}" must be an array.`;
    }
    if (prop.type === 'object' && (typeof value !== 'object' || Array.isArray(value) || value === null)) {
      return `Field "${key}" must be an object.`;
    }

    // String length limits (prevent abuse)
    if (prop.type === 'string' && typeof value === 'string') {
      const maxLen = key === 'summary' || key === 'objective' || key === 'question' ? 10000 : 2000;
      if (value.length > maxLen) {
        return `Field "${key}" exceeds maximum length of ${maxLen} characters.`;
      }
    }

    // Enum validation
    if (prop.enum && !prop.enum.includes(value)) {
      return `Field "${key}" must be one of: ${prop.enum.join(', ')}. Got: "${value}".`;
    }
  }

  return null;
}
