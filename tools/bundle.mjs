/**
 * A very small ES module bundler and minifier.
 * The app has no dependencies, so bundling is only about inlining local modules
 * into one script that runs in a browser without module support requirements.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const IMPORT_RE = /^import\s*\{([\s\S]*?)\}\s*from\s*'([^']+)';?[ \t]*$/gm;
const EXPORT_FUNCTION_RE = /^export\s+(async\s+)?function\s+([A-Za-z0-9_$]+)/gm;
const EXPORT_CLASS_RE = /^export\s+class\s+([A-Za-z0-9_$]+)/gm;
const EXPORT_VARIABLE_RE = /^export\s+(const|let|var)\s+([A-Za-z0-9_$]+)/gm;

/** Rewrites one module: imports become __require calls, exports become a returned object. */
export function transformModule(source, modulePath) {
  const imports = [];
  let code = source.replace(IMPORT_RE, (match, names, from) => {
    const target = resolveModule(modulePath, from);
    imports.push(target);
    const bindings = names.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [original, alias] = part.split(/\s+as\s+/);
      return alias ? `${original}: ${alias}` : original;
    }).join(', ');
    return `const { ${bindings} } = __require(${JSON.stringify(target)});`;
  });

  const exported = [];
  code = code.replace(EXPORT_FUNCTION_RE, (match, isAsync, name) => {
    exported.push(name);
    return `${isAsync || ''}function ${name}`;
  });
  code = code.replace(EXPORT_CLASS_RE, (match, name) => {
    exported.push(name);
    return `class ${name}`;
  });
  code = code.replace(EXPORT_VARIABLE_RE, (match, keyword, name) => {
    exported.push(name);
    return `${keyword} ${name}`;
  });
  if (/^export\s/m.test(code)) {
    throw new Error(`Unsupported export syntax in ${modulePath}`);
  }
  return { code, imports, exported };
}

function resolveModule(fromPath, specifier) {
  return normalize(join(dirname(fromPath), specifier)).split('\\').join('/');
}

/**
 * Bundles a module graph into one IIFE.
 * @param {string} entry path of the entry module relative to `root`
 * @param {string} root source directory
 */
export function bundle(entry, root) {
  const modules = new Map();
  const visit = (modulePath) => {
    if (modules.has(modulePath)) return;
    const source = readFileSync(join(root, modulePath), 'utf8');
    const transformed = transformModule(source, modulePath);
    modules.set(modulePath, transformed);
    transformed.imports.forEach(visit);
  };
  visit(entry);

  const parts = ['(function () {', "'use strict';", 'const __cache = {};', 'const __modules = {};',
    'function __require(name) {',
    '  if (!(name in __cache)) { __cache[name] = __modules[name](); }',
    '  return __cache[name];',
    '}'];
  for (const [modulePath, module] of modules) {
    parts.push(`__modules[${JSON.stringify(modulePath)}] = function () {`);
    parts.push(module.code);
    parts.push(`return { ${module.exported.join(', ')} };`);
    parts.push('};');
  }
  parts.push(`__require(${JSON.stringify(entry)});`);
  parts.push('})();');
  return { code: parts.join('\n'), moduleCount: modules.size };
}

/**
 * Conservative JavaScript minifier: removes comments and needless whitespace but
 * keeps every identifier and every line break that could matter.
 */
export function minifyJs(source) {
  let output = '';
  let index = 0;
  const previousToken = () => {
    for (let position = output.length - 1; position >= 0; position -= 1) {
      const char = output[position];
      if (char !== ' ' && char !== '\n') return char;
    }
    return '';
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      let literal = char;
      index += 1;
      while (index < source.length) {
        const current = source[index];
        literal += current;
        if (current === '\\') {
          literal += source[index + 1] ?? '';
          index += 2;
          continue;
        }
        index += 1;
        if (current === quote) break;
      }
      output += literal;
      continue;
    }
    if (char === '/' && isRegexStart(previousToken())) {
      let literal = '/';
      index += 1;
      let inClass = false;
      while (index < source.length) {
        const current = source[index];
        literal += current;
        index += 1;
        if (current === '\\') {
          literal += source[index] ?? '';
          index += 1;
          continue;
        }
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) break;
      }
      while (index < source.length && /[a-z]/.test(source[index])) {
        literal += source[index];
        index += 1;
      }
      output += literal;
      continue;
    }
    if (char === '\n') {
      if (!output.endsWith('\n')) output += '\n';
      index += 1;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (!output.endsWith(' ') && !output.endsWith('\n')) output += ' ';
      index += 1;
      continue;
    }
    output += char;
    index += 1;
  }
  return output.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

function isRegexStart(token) {
  return token === '' || '(,=:[!&|?{};+-*%<>~^'.includes(token);
}

/** Removes comments and collapses whitespace in CSS. */
export function minifyCss(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Used by the build to report sizes. */
export function relativeTo(root, path) {
  return relative(root, path);
}
