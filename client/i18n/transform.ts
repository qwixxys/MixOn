// Build-time translation: the interface is written in Russian, and this pass wraps every Russian text shown to people
// in a call that looks it up in the English dictionary (src/i18n/en.ts) when English is chosen. The source stays
// plain; `npm run i18n:check` lists texts that still lack a translation.
//
//   <h1>Сервисы</h1>                 → <h1>{__t("Сервисы")}</h1>
//   title="Очередь"                  → title={__t("Очередь")}
//   toast('Найдено ' + n)            → toast(__t("Найдено ") + n)
//   `Найдено ${n} ${plural(n, …)}`   → __t("Найдено {0} {1}", [n, plural(n, …)])
//
// Left alone: types, object keys, regular expressions, tagged templates, strings compared with === or used in `case`
// (logic, not text), and whatever follows a comment saying i18n-ignore. Line breaks are kept, so stack traces still
// point at the right lines.
import ts from 'typescript';

export const CYRILLIC = /[А-Яа-яЁё]/;

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** How React renders a JSX text node: lines trimmed and joined with single spaces, blank lines dropped. */
export function jsxTextValue(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((line, i) => {
    if (/[^ \t]/.test(line)) lastNonEmpty = i;
  });
  let out = '';
  lines.forEach((line, i) => {
    let trimmed = line.replace(/\t/g, ' ');
    if (i !== 0) trimmed = trimmed.replace(/^ +/, '');
    if (i !== lines.length - 1) trimmed = trimmed.replace(/ +$/, '');
    if (trimmed) out += i === lastNonEmpty ? trimmed : `${trimmed} `;
  });
  return out;
}

const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** Strings that are data or logic rather than text for people. */
function isLogic(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return true;
  if (ts.isBinaryExpression(parent) && COMPARISONS.has(parent.operatorToken.kind)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isLiteralTypeNode(parent)) return true;
  return false;
}

const newlines = (text: string) => (text.match(/\n/g) ?? []).length;

export interface Found {
  /** The dictionary key: the Russian text, with {0}, {1}… for a template's values. */
  key: string;
  line: number;
}

/**
 * Finds the texts to translate in one file and returns them with the file's code, the texts wrapped in `fn(...)` (null
 * when there is nothing to wrap). `fn` is the name the runtime is imported under.
 */
export function translateSource(code: string, fileName: string, fn = '__t') {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const keys: Found[] = [];
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  /** The source of [start, end) with the edits inside it applied. */
  const render = (start: number, end: number, edits: Edit[]) => {
    let out = '';
    let pos = start;
    for (const e of [...edits].sort((a, b) => a.start - b.start)) {
      out += code.slice(pos, e.start) + e.text;
      pos = e.end;
    }
    return out + code.slice(pos, end);
  };
  /** Keeps the line count: a replacement spanning lines gets as many line breaks back, where JS allows them. */
  const pad = (start: number, end: number, text: string) => '\n'.repeat(Math.max(0, newlines(code.slice(start, end)) - newlines(text)));

  const ignored = (node: ts.Node) =>
    (ts.getLeadingCommentRanges(code, node.pos) ?? []).some((c) => code.slice(c.pos, c.end).includes('i18n-ignore'));

  const collect = (node: ts.Node): Edit[] => {
    if (ts.isTypeNode(node) || ts.isTaggedTemplateExpression(node) || ts.isRegularExpressionLiteral(node)) return [];
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ignored(node)) return [];

    if (ts.isJsxText(node)) {
      if (!CYRILLIC.test(node.text)) return [];
      const value = jsxTextValue(node.text);
      const core = value.trim();
      if (!core) return [];
      keys.push({ key: core, line: line(node.pos) });
      const lead = /^\s/.test(value) ? '{" "}' : '';
      const trail = /\s$/.test(value) ? '{" "}' : '';
      const call = `${fn}(${JSON.stringify(core)})`;
      return [{ start: node.pos, end: node.end, text: `${lead}{${call}${pad(node.pos, node.end, call)}}${trail}` }];
    }

    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CYRILLIC.test(node.text) && !isLogic(node)) {
      const start = node.getStart(sf);
      keys.push({ key: node.text, line: line(start) });
      const call = `${fn}(${JSON.stringify(node.text)}${pad(start, node.end, '')})`;
      // In JSX, title="…" becomes title={…}.
      return [{ start, end: node.end, text: ts.isJsxAttribute(node.parent) ? `{${call}}` : call }];
    }

    if (ts.isTemplateExpression(node) && [node.head, ...node.templateSpans.map((s) => s.literal)].some((p) => CYRILLIC.test(p.text)) && !isLogic(node)) {
      const start = node.getStart(sf);
      let key = node.head.text;
      const args: string[] = [];
      node.templateSpans.forEach((span, i) => {
        key += `{${i}}${span.literal.text}`;
        const expr = span.expression;
        args.push(render(expr.getStart(sf), expr.end, collect(expr)));
      });
      keys.push({ key, line: line(start) });
      const body = `${JSON.stringify(key)}, [${args.join(', ')}]`;
      return [{ start, end: node.end, text: `${fn}(${body}${pad(start, node.end, body)})` }];
    }

    const edits: Edit[] = [];
    ts.forEachChild(node, (child) => {
      edits.push(...collect(child));
    });
    return edits;
  };

  const edits = collect(sf);
  return { keys, code: edits.length ? render(0, code.length, edits) : null };
}
