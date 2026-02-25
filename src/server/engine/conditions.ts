/**
 * Safe condition evaluator for the Warchief game engine.
 *
 * Replaces the unsafe `eval()` approach with a proper parser that
 * only supports the limited expression syntax used in flowchart conditions.
 *
 * ## Supported Syntax
 *
 * - Comparisons: `<`, `>`, `<=`, `>=`, `==`, `!=`
 * - Logical operators: `&&`, `||`
 * - Variables from event data (e.g., `distance`, `lossPercent`, `damage`)
 * - Number literals
 * - String literals in double quotes (e.g., `direction == "left"`)
 * - Parentheses for grouping
 *
 * ## Examples
 *
 * ```ts
 * evaluateCondition('distance < 50', { type: 'enemy_spotted', distance: 30 })
 * // => true
 *
 * evaluateCondition('distance >= 100 && damage > 5', { type: 'under_attack', distance: 120, damage: 10 })
 * // => true
 *
 * evaluateCondition('lossPercent > 30', { type: 'casualty_threshold', lossPercent: 25 })
 * // => false
 * ```
 */

import type { GameEvent } from '../../shared/events/index.js';

/**
 * Evaluate a condition string against event data.
 *
 * Returns true if the condition matches, false otherwise.
 * Empty or undefined conditions always return true.
 * Malformed conditions return false (fail-safe).
 */
export function evaluateCondition(condition: string | undefined, event: GameEvent): boolean {
  if (!condition || condition.trim() === '') return true;

  try {
    const tokens = tokenize(condition);
    const result = parseExpression(tokens, event);
    return Boolean(result.value);
  } catch (e) {
    // Fail-safe: if we can't parse the condition, return false
    return false;
  }
}

// ─── Tokenizer ──────────────────────────────────────────────────────────────

type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'operator'
  | 'logical'
  | 'lparen'
  | 'rparen';

interface Token {
  type: TokenType;
  value: string;
}

const OPERATORS = ['<=', '>=', '!=', '==', '<', '>'];
const LOGICAL = ['&&', '||'];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i]!)) {
      i++;
      continue;
    }

    // Parentheses
    if (input[i] === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }
    if (input[i] === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }

    // Logical operators (&&, ||)
    if (i + 1 < input.length) {
      const twoChar = input.slice(i, i + 2);
      if (LOGICAL.includes(twoChar)) {
        tokens.push({ type: 'logical', value: twoChar });
        i += 2;
        continue;
      }
    }

    // Comparison operators (<=, >=, !=, ==, <, >)
    let matchedOp = false;
    for (const op of OPERATORS) {
      if (input.slice(i, i + op.length) === op) {
        tokens.push({ type: 'operator', value: op });
        i += op.length;
        matchedOp = true;
        break;
      }
    }
    if (matchedOp) continue;

    // Number literals (including negative numbers and decimals)
    if (/[\d.]/.test(input[i]!) || (input[i] === '-' && i + 1 < input.length && /[\d.]/.test(input[i + 1]!))) {
      let num = '';
      if (input[i] === '-') {
        num += '-';
        i++;
      }
      while (i < input.length && /[\d.]/.test(input[i]!)) {
        num += input[i];
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // String literals
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i];
      let str = '';
      i++; // skip opening quote
      while (i < input.length && input[i] !== quote) {
        str += input[i];
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Identifiers (variable names)
    if (/[a-zA-Z_]/.test(input[i]!)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z_\d]/.test(input[i]!)) {
        ident += input[i];
        i++;
      }

      // Handle 'true' and 'false' as boolean values
      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'number', value: ident === 'true' ? '1' : '0' });
      } else {
        tokens.push({ type: 'identifier', value: ident });
      }
      continue;
    }

    // Unknown character — skip
    i++;
  }

  return tokens;
}

// ─── Parser ─────────────────────────────────────────────────────────────────

interface ParseResult {
  value: number | string | boolean;
  pos: number;
}

function parseExpression(tokens: Token[], event: GameEvent, pos: number = 0): ParseResult {
  // Parse left side of potential logical operator
  let result = parseComparison(tokens, event, pos);

  // Check for logical operators (&&, ||)
  while (result.pos < tokens.length && tokens[result.pos]?.type === 'logical') {
    const op = tokens[result.pos]!.value;
    const right = parseComparison(tokens, event, result.pos + 1);

    if (op === '&&') {
      result = { value: Boolean(result.value) && Boolean(right.value), pos: right.pos };
    } else {
      result = { value: Boolean(result.value) || Boolean(right.value), pos: right.pos };
    }
  }

  return result;
}

function parseComparison(tokens: Token[], event: GameEvent, pos: number): ParseResult {
  // Handle parenthesized expressions
  if (pos < tokens.length && tokens[pos]?.type === 'lparen') {
    const inner = parseExpression(tokens, event, pos + 1);
    // Skip closing paren
    const nextPos = inner.pos < tokens.length && tokens[inner.pos]?.type === 'rparen'
      ? inner.pos + 1
      : inner.pos;

    // Check if this parenthesized expression is followed by an operator
    if (nextPos < tokens.length && tokens[nextPos]?.type === 'operator') {
      return compareValues(inner.value, tokens, event, nextPos);
    }

    return { value: inner.value, pos: nextPos };
  }

  const left = resolveValue(tokens, event, pos);

  // Check for comparison operator
  if (left.pos < tokens.length && tokens[left.pos]?.type === 'operator') {
    return compareValues(left.value, tokens, event, left.pos);
  }

  return left;
}

function compareValues(leftValue: number | string | boolean, tokens: Token[], event: GameEvent, opPos: number): ParseResult {
  const op = tokens[opPos]!.value;
  const right = resolveValue(tokens, event, opPos + 1);

  const lv = typeof leftValue === 'boolean' ? (leftValue ? 1 : 0) : leftValue;
  const rv = typeof right.value === 'boolean' ? (right.value ? 1 : 0) : right.value;

  let result: boolean;
  switch (op) {
    case '<':  result = lv < rv; break;
    case '>':  result = lv > rv; break;
    case '<=': result = lv <= rv; break;
    case '>=': result = lv >= rv; break;
    case '==': result = lv == rv; break;
    case '!=': result = lv != rv; break;
    default:   result = false;
  }

  return { value: result, pos: right.pos };
}

function resolveValue(tokens: Token[], event: GameEvent, pos: number): ParseResult {
  if (pos >= tokens.length) {
    return { value: 0, pos };
  }

  const token = tokens[pos]!;

  switch (token.type) {
    case 'number':
      return { value: parseFloat(token.value), pos: pos + 1 };

    case 'string':
      return { value: token.value, pos: pos + 1 };

    case 'identifier': {
      const eventData = event as unknown as Record<string, unknown>;
      const val = eventData[token.value];
      if (typeof val === 'number') return { value: val, pos: pos + 1 };
      if (typeof val === 'string') return { value: val, pos: pos + 1 };
      if (typeof val === 'boolean') return { value: val ? 1 : 0, pos: pos + 1 };
      return { value: 0, pos: pos + 1 };
    }

    case 'lparen': {
      const inner = parseExpression(tokens, event, pos + 1);
      const nextPos = inner.pos < tokens.length && tokens[inner.pos]?.type === 'rparen'
        ? inner.pos + 1
        : inner.pos;
      return { value: inner.value, pos: nextPos };
    }

    default:
      return { value: 0, pos: pos + 1 };
  }
}
