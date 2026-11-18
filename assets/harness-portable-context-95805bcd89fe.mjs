export const CONTEXT_LIMITS = Object.freeze({
  name: 100,
  goal: 2_000,
  instructions: 3_000,
  references: 12_000,
  outputFormat: 2_000,
});

export const MAX_PORTABLE_CONTEXT_BYTES = 128_000;
const FORMAT = "harness.context";
const FIELD_LABELS = Object.freeze({
  name: "Name",
  goal: "Goal",
  instructions: "Instructions",
  references: "Reference material",
  outputFormat: "Output format",
});

/** @typedef {{name: string, goal: string, instructions: string, references: string, outputFormat: string}} ContextInput */

/** @param {unknown} value @param {string[]} keys */
function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** @param {unknown} input @returns {ContextInput} */
export function validateContextInput(input) {
  const fields = /** @type {(keyof ContextInput)[]} */ (Object.keys(CONTEXT_LIMITS));
  if (!hasExactKeys(input, fields)) throw new Error("This brief must contain the five Harness context fields.");
  const values = /** @type {Record<keyof ContextInput, unknown>} */ (input);
  const context = /** @type {ContextInput} */ ({});
  for (const field of fields) {
    const value = values[field];
    if (typeof value !== "string" || /[\u0000\uD800-\uDFFF]/u.test(value)) {
      throw new Error(`${FIELD_LABELS[field]} must contain readable text.`);
    }
    const cleaned = value.trim();
    if (cleaned.length > CONTEXT_LIMITS[field]) {
      throw new Error(`${FIELD_LABELS[field]} must be at most ${CONTEXT_LIMITS[field]} characters.`);
    }
    context[field] = cleaned;
  }
  if (context.name.length < 2 || /[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(context.name)) {
    throw new Error("Use a single-line name with at least two characters.");
  }
  if (context.goal.length < 4) throw new Error("Enter a goal with at least four characters.");
  return context;
}

/** @param {unknown} context */
export function createPortableContext(context) {
  return { format: FORMAT, version: 1, context: validateContextInput(context) };
}

/** @param {string} text @returns {ContextInput} */
export function readPortableContext(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_PORTABLE_CONTEXT_BYTES) {
    throw new Error("Choose a Harness brief file under 128 KB.");
  }
  let envelope;
  try {
    envelope = JSON.parse(text.trim());
  } catch {
    throw new Error("Choose a readable Harness brief JSON file.");
  }
  if (!hasExactKeys(envelope, ["format", "version", "context"]) || envelope.format !== FORMAT || envelope.version !== 1) {
    throw new Error("Choose a Harness context file exported by a supported version.");
  }
  return validateContextInput(envelope.context);
}
