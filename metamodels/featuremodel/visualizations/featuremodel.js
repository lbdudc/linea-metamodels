// Visualizations of the feature model: the views of a featuremodel instance that only this metamodel knows how to draw.
// The file is the body of a function that returns them; `kit` is what bango gives to draw with (a canvas, SVG helpers, tree edits).
//
// Feature diagram: the features as a tree, FODA style. The line to a mandatory feature is solid, to an optional one dashed; the features
// of an alternative (exactly one) or an or group (at least one) share a colour and are marked `xor` / `or`; a cardinality group is marked `[m..n]`. Select a feature to edit it in
// the panel at the side, use the buttons to add a feature under the selected one, Delete removes the selected feature (and its subtree).
// Constraints are listed under the diagram.
//
// UVL and XML: the same model as text, in the formats other tools use (UVL, and the XML of FeatureIDE). Typing in them changes the model.

const KIND_COLOR = { mandatory: '#3b82f6', optional: '#64748b', alternative: '#f59e0b', or: '#10b981', cardinality: '#a855f7' };
const KIND_MARK = { alternative: 'xor', or: 'or' };
const CHAR = 7;
const HEIGHT = 30;

/** a name that no feature has yet: Feature, Feature2, Feature3, ... */
const freshName = (taken, base) => {
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}${i}`;
    if (!taken.has(name)) return name;
  }
};

/** `[1..2]`, `[2..*]` or `[2]`: the cardinality of a group, as it is written */
const cardinalityText = g => `[${g.props.min}${g.props.unbounded ? '..*' : g.props.max !== undefined ? `..${g.props.max}` : ''}]`;

/** a child feature of a node is one node or a list of them: always a list */
const many = value => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** the text of a formula, with the operators and names as the author wrote them */
const operandText = node => {
  const base = node.children.inner ? `(${constraintText(many(node.children.inner)[0])})` : many(node.refs.feature)[0]?.text ?? '?';
  return node.props.negated ? `!${base}` : base;
};
const constraintText = node => [operandText(many(node.children.first)[0]), ...many(node.children.links).map(l => `${l.props.operator} ${operandText(many(l.children.operand)[0])}`)].join(' ');

// ------------------------------------------------------------------------------------------------ text formats
// The feature model as text in the formats the rest of the world uses: UVL (the Universal Variability Language, Boolean level) and the XML of
// FeatureIDE. Both read and print the tree the JSON mapping gives (`featureModel`): { name, root: { name, abstract?, groups: [{ kind, min?, max?,
// features }] }, constraints: [formula] }, a formula being { feature }, { not }, or { operator, left, right }.

const PRECEDENCE = new Map([['<=>', 1], ['=>', 2], ['|', 3], ['&', 4]]);

/** one text format: `parse` turns text into the tree (and throws an Error saying what is wrong), `print` the other way */
const formats = {};

// ---------------------------------------------------------------------------------------------------------------- UVL
{
  const KEYWORDS = new Set([
    'include', 'features', 'imports', 'namespace', 'as', 'constraint', 'constraints', 'cardinality', 'String', 'Boolean', 'Integer', 'Real', 'len', 'sum',
    'avg', 'floor', 'ceil', 'Type', 'Arithmetic', 'group-cardinality', 'feature-cardinality', 'aggregate-function', 'string-constraints',
    'or', 'alternative', 'optional', 'mandatory', 'true', 'false'
  ]);
  const STRICT = /^[a-zA-Z][a-zA-Z0-9_#§%?\\'äüöß;]*$/;
  // a name that is not a plain word is written between double quotes; those cannot hold a dot, a quote or a line break
  const name = text => (STRICT.test(text) && !KEYWORDS.has(text) ? text : `"${text.replace(/[".\r\n]/g, '_')}"`);

  const formula = (f, top) => {
    if (f.feature !== undefined) return name(f.feature);
    if (f.not !== undefined) return `!${formula(f.not, false)}`;
    const text = `${formula(f.left, false)} ${f.operator} ${formula(f.right, false)}`;
    return top ? text : `(${text})`;
  };

  const group = g => (g.kind !== 'cardinality' ? g.kind : `[${g.min}${g.max === undefined ? '..*' : g.max === g.min ? '' : `..${g.max}`}]`);

  const print = tree => {
    const lines = ['features'];
    const feature = (f, depth) => {
      lines.push(`${'\t'.repeat(depth)}${name(f.name)}${f.abstract ? ' {abstract}' : ''}`);
      // UVL wants at least one feature in a group: an empty one is left out
      for (const g of f.groups.filter(x => x.features.length)) {
        lines.push(`${'\t'.repeat(depth + 1)}${group(g)}`);
        g.features.forEach(child => feature(child, depth + 2));
      }
    };
    feature(tree.root, 1);
    if (tree.constraints.length) lines.push('', 'constraints', ...tree.constraints.map(c => `\t${formula(c, true)}`));
    return `${lines.join('\n')}\n`;
  };

  // (the UVL grammar says a plain name starts with a letter, but models published on UVLHub have names that start with `_`: they are read, and written between quotes)
  const NAME = /^("[^"\r\n]+"|[a-zA-Z_][a-zA-Z0-9_#§%?\\'äüöß;]*)/;
  const unquote = text => (text.startsWith('"') ? text.slice(1, -1) : text);

  const parse = text => {
    const lines = [];
    // comments go: `//` to the end of the line, and `/* ... */` (keeping the line breaks so line numbers stay)
    text.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' ')).split(/\r?\n/).forEach((raw, i) => {
      const code = raw.replace(/\/\/.*$/, '');
      if (code.trim()) lines.push({ no: i + 1, indent: code.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length, text: code.trim() });
    });
    const fail = (line, message) => { throw new Error(`line ${line.no}: ${message}`); };
    let at = 0;
    let model = { name: undefined, root: undefined, constraints: [] };

    const feature = () => {
      const line = lines[at++];
      const m = /^(?:(String|Integer|Boolean|Real)\s+)?(.*)$/.exec(line.text);
      if (m[1]) fail(line, `typed features (${m[1]}) are not supported`);
      const n = NAME.exec(m[2]);
      if (!n) fail(line, `expected a feature name, found '${m[2]}'`);
      let rest = m[2].slice(n[0].length).trim();
      if (/^cardinality\b/.test(rest)) fail(line, 'feature cardinalities are not supported');
      let abstract = false;
      if (rest.startsWith('{')) {
        const close = rest.lastIndexOf('}');
        if (close < 0) fail(line, "an attribute list is missing its '}'");
        abstract = rest.slice(1, close).split(',').some(a => /^\s*abstract(\s+true)?\s*$/.test(a));
        rest = rest.slice(close + 1).trim();
      }
      if (rest) fail(line, `unexpected '${rest}' after the feature name`);
      const out = { name: unquote(n[0]), ...(abstract ? { abstract: true } : {}), groups: [] };
      while (at < lines.length && lines[at].indent > line.indent) {
        const g = lines[at++];
        const kind = /^(mandatory|optional|alternative|or)$/.exec(g.text);
        const card = /^\[\s*(\d+)\s*(?:\.\.\s*(\d+|\*)\s*)?\]$/.exec(g.text);
        if (!kind && !card) fail(g, `expected mandatory, optional, alternative, or, or a cardinality like [1..2], found '${g.text}'`);
        const entry = kind
          ? { kind: kind[1], features: [] }
          : { kind: 'cardinality', min: Number(card[1]), ...(card[2] === '*' ? {} : { max: card[2] === undefined ? Number(card[1]) : Number(card[2]) }), features: [] };
        const indent = at < lines.length ? lines[at].indent : 0;
        if (!(indent > g.indent)) fail(g, 'a group needs its features, indented below it');
        while (at < lines.length && lines[at].indent > g.indent) {
          if (lines[at].indent !== indent) fail(lines[at], 'the features of a group must be indented the same');
          entry.features.push(feature());
        }
        out.groups.push(entry);
      }
      return out;
    };

    const constraint = line => {
      const tokens = [...line.text.matchAll(/\s*(<=>|=>|[()!&|]|"[^"\r\n]+"|[a-zA-Z_][a-zA-Z0-9_#§%?\\'äüöß;]*|\S)/g)].map(t => t[1]);
      let p = 0;
      const isName = t => t !== undefined && (t.startsWith('"') || /^[a-zA-Z_]/.test(t)) && !PRECEDENCE.has(t);
      const operand = () => {
        const t = tokens[p++];
        if (t === '!') return { not: operand() };
        if (t === '(') {
          const inner = climb(1);
          if (tokens[p++] !== ')') fail(line, "a '(' is not closed");
          return inner;
        }
        if (isName(t)) {
          if (tokens[p] === '(' || tokens[p] === '.') fail(line, 'aggregate functions and qualified names are not supported');
          return { feature: unquote(t) };
        }
        return fail(line, t === undefined ? 'the constraint ends too soon' : `unexpected '${t}' (only feature names and ! & | => <=> are supported)`);
      };
      // all the operators group to the left, as in UVL: from the tightest, & | => <=>
      const climb = least => {
        let left = operand();
        while (PRECEDENCE.has(tokens[p]) && PRECEDENCE.get(tokens[p]) >= least) {
          const operator = tokens[p++];
          left = { operator, left, right: climb(PRECEDENCE.get(operator) + 1) };
        }
        return left;
      };
      const result = climb(1);
      if (p < tokens.length) fail(line, `unexpected '${tokens[p]}'`);
      return result;
    };

    while (at < lines.length) {
      const line = lines[at];
      if (line.indent !== 0) fail(line, 'unexpected indentation');
      const word = /^\w+/.exec(line.text)?.[0];
      if (word === 'namespace') { model.name = line.text.slice(9).trim(); at++; }
      else if (word === 'include' || word === 'imports') { at++; while (at < lines.length && lines[at].indent > 0) at++; }
      else if (word === 'features') {
        at++;
        if (!(at < lines.length && lines[at].indent > 0)) fail(line, "'features' needs its root feature, indented below it");
        const indent = lines[at].indent;
        model.root = feature();
        if (at < lines.length && lines[at].indent > 0) fail(lines[at], indent === lines[at].indent ? 'a feature model has one root feature' : 'unexpected indentation');
      } else if (word === 'constraints') {
        at++;
        while (at < lines.length && lines[at].indent > 0) model.constraints.push(constraint(lines[at++]));
      } else fail(line, `expected 'features' or 'constraints', found '${line.text}'`);
    }
    if (!model.root) throw new Error("there is no 'features' section");
    return { name: model.name ?? model.root.name, root: model.root, constraints: model.constraints };
  };

  formats.uvl = { print, parse, name };
}

// ---------------------------------------------------------------------------------------------------------------- XML
{
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const TAG = { '&': 'conj', '|': 'disj', '=>': 'imp', '<=>': 'eq' };
  const OPERATOR = { conj: '&', disj: '|', imp: '=>', eq: '<=>' };

  const print = tree => {
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>', '<featureModel>', '\t<struct>'];
    // an alternative or an or group: the element a feature of that kind has
    const choiceOf = g => {
      if (g.kind === 'alternative' || (g.kind === 'cardinality' && g.min === 1 && g.max === 1)) return 'alt';
      if (g.kind === 'or' || (g.kind === 'cardinality' && g.min === 1 && g.max === undefined)) return 'or';
      if (g.kind === 'cardinality') throw new Error(`XML cannot say a group of cardinality [${g.min}..${g.max ?? '*'}]: only [1..1] (alternative) and [1..*] (or)`);
      return undefined;
    };
    const attrs = (f, mandatory) => `${f.abstract ? ' abstract="true"' : ''}${mandatory ? ' mandatory="true"' : ''} name="${escape(f.name)}"`;
    const feature = (f, depth, mandatory) => {
      const pad = '\t'.repeat(depth);
      const groups = f.groups.filter(g => g.features.length);
      if (!groups.length) return out.push(`${pad}<feature${attrs(f, mandatory)}/>`);
      const plain = groups.filter(g => !choiceOf(g));
      const choices = groups.filter(g => choiceOf(g));
      // FeatureIDE has one kind of group per feature: a feature with an alternative or an or group and nothing else is of that kind...
      if (!plain.length && choices.length === 1) {
        out.push(`${pad}<${choiceOf(choices[0])}${attrs(f, mandatory)}>`);
        choices[0].features.forEach(c => feature(c, depth + 1, false));
        return out.push(`${pad}</${choiceOf(choices[0])}>`);
      }
      // ...else it is an `and`, and each choice becomes an abstract feature of its own below it
      out.push(`${pad}<and${attrs(f, mandatory)}>`);
      for (const g of plain) g.features.forEach(c => feature(c, depth + 1, g.kind === 'mandatory'));
      choices.forEach((g, i) => {
        const tag = choiceOf(g);
        out.push(`${pad}\t<${tag} abstract="true" mandatory="true" name="${escape(`${f.name}_${tag}${choices.length > 1 ? i + 1 : ''}`)}">`);
        g.features.forEach(c => feature(c, depth + 2, false));
        out.push(`${pad}\t</${tag}>`);
      });
      return out.push(`${pad}</and>`);
    };
    feature(tree.root, 2, false);
    out.push('\t</struct>');
    if (tree.constraints.length) {
      const formula = (f, depth) => {
        const pad = '\t'.repeat(depth);
        if (f.feature !== undefined) return [`${pad}<var>${escape(f.feature)}</var>`];
        if (f.not !== undefined) return [`${pad}<not>`, ...formula(f.not, depth + 1), `${pad}</not>`];
        return [`${pad}<${TAG[f.operator]}>`, ...formula(f.left, depth + 1), ...formula(f.right, depth + 1), `${pad}</${TAG[f.operator]}>`];
      };
      out.push('\t<constraints>');
      for (const c of tree.constraints) out.push('\t\t<rule>', ...formula(c, 3), '\t\t</rule>');
      out.push('\t</constraints>');
    }
    out.push('</featureModel>');
    return `${out.join('\n')}\n`;
  };

  const parse = text => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const broken = doc.getElementsByTagName('parsererror')[0];
    if (broken) throw new Error(`not well-formed XML: ${broken.textContent.trim().split('\n')[0]}`);
    const kids = el => [...el.children];
    const root = kids(doc.documentElement).find(e => e.tagName === 'struct');
    if (!root || kids(root).length !== 1) throw new Error('expected <featureModel><struct> with one root feature');

    const feature = el => {
      const name = el.getAttribute('name');
      if (!name) throw new Error(`a <${el.tagName}> has no name`);
      const out = { name, ...(el.getAttribute('abstract') === 'true' ? { abstract: true } : {}), groups: [] };
      const children = kids(el);
      if (!['and', 'or', 'alt', 'feature'].includes(el.tagName)) throw new Error(`unknown element <${el.tagName}>`);
      if (el.tagName === 'or' || el.tagName === 'alt') {
        if (children.length) out.groups.push({ kind: el.tagName === 'or' ? 'or' : 'alternative', features: children.map(feature) });
      } else {
        const mandatory = children.filter(c => c.getAttribute('mandatory') === 'true');
        const optional = children.filter(c => c.getAttribute('mandatory') !== 'true');
        if (mandatory.length) out.groups.push({ kind: 'mandatory', features: mandatory.map(feature) });
        if (optional.length) out.groups.push({ kind: 'optional', features: optional.map(feature) });
      }
      return out;
    };

    const formula = el => {
      const children = kids(el);
      if (el.tagName === 'var') return { feature: el.textContent.trim() };
      if (el.tagName === 'not') return { not: formula(children[0]) };
      const operator = OPERATOR[el.tagName];
      if (!operator || children.length < 2) throw new Error(`cannot read the constraint element <${el.tagName}>`);
      // conj and disj may have more than two operands
      return children.map(formula).reduce((left, right) => ({ operator, left, right }));
    };

    const rootFeature = feature(kids(root)[0]);
    const constraints = kids(doc.documentElement).filter(e => e.tagName === 'constraints').flatMap(c => kids(c).filter(r => r.tagName === 'rule').map(r => formula(kids(r)[0])));
    return { name: rootFeature.name, root: rootFeature, constraints };
  };

  formats.xml = { print, parse };
}

// ------------------------------------------------------------------------------------------------------------- UVL intelligence
// What a language server tells about a UVL text, worked out here from the text alone (so the editor needs no server): where each feature is
// declared and used, the outline, what is wrong (with its line), completion, hover, rename, and a tidy layout. Positions are 1-based.
// `scan` is the one pass the rest is made from.
const uvlTools = (() => {
  const GROUPS = {
    mandatory: 'Mandatory: the features below are in whenever their parent is.',
    optional: 'Optional: each feature below may be in or out, independently.',
    alternative: 'Alternative: exactly one of the features below is chosen when the parent is in.',
    or: 'Or: at least one of the features below is chosen when the parent is in.'
  };
  const OPERATORS = {
    '!': 'Not: true when the feature is out.',
    '&': 'And: both sides hold.',
    '|': 'Or: at least one side holds.',
    '=>': 'Implies: if the left side holds, the right one must too.',
    '<=>': 'Equivalent: both sides hold or neither does.'
  };
  const SECTIONS = {
    features: 'The feature tree: the root feature, and below it groups of features.',
    constraints: 'Rules across the tree, one per line: features joined with ! & | => <=>.',
    namespace: 'The namespace of the model.',
    include: 'Includes language levels (not used by LINEA).',
    imports: 'Imports other models (not used by LINEA).'
  };
  const NAME = /"[^"\r\n]+"|[A-Za-z_][A-Za-z0-9_#§%?\\'äüöß;]*/y;
  const GROUP_HEADER = /^(mandatory|optional|alternative|or)$|^\[\s*\d+\s*(?:\.\.\s*(?:\d+|\*)\s*)?\]$/;
  const unquote = text => (text.startsWith('"') ? text.slice(1, -1) : text);
  const widthOf = lead => lead.replace(/\t/g, '    ').length;

  const scan = text => {
    const lines = text.split(/\r?\n/);
    const features = [];
    const groups = [];
    const refs = [];
    const problems = [];
    const rows = [];
    const keywords = [];
    let section;
    const stack = [];
    const byName = new Map();
    const problem = (line, column, endColumn, message, severity = 'error') => problems.push({ line, column, endColumn, message, severity });

    lines.forEach((raw, index) => {
      const lineNo = index + 1;
      const code = raw.replace(/\/\/.*$/, '');
      if (code.trim() === '') { rows.push({ line: lineNo, blank: true, comment: raw.trim() !== '' }); return; }
      const lead = /^[ \t]*/.exec(code)[0];
      const indent = widthOf(lead);
      const body = code.slice(lead.length).replace(/\s+$/, '');
      const col = lead.length + 1;
      const row = { line: lineNo, indent, body, col, depth: 0 };
      rows.push(row);

      if (indent === 0) {
        const word = /^\w+/.exec(body)?.[0];
        if (word && SECTIONS[word]) {
          section = word;
          keywords.push({ word, line: lineNo, column: 1, endColumn: 1 + word.length });
          stack.length = 0;
          row.depth = 0;
          return;
        }
        section = 'other';
        problem(lineNo, 1, raw.length + 1, `Expected 'features' or 'constraints', found '${body.slice(0, 30)}'.`);
        return;
      }
      if (section === 'constraints') {
        row.depth = 1;
        const tokens = [...body.matchAll(/<=>|=>|[()!&|]|"[^"\r\n]+"|[A-Za-z_][A-Za-z0-9_#§%?\\'äüöß;]*|\S/g)];
        for (const m of tokens) {
          const t = m[0];
          const column = col + m.index;
          if (/^("|[A-Za-z_])/.test(t)) refs.push({ name: unquote(t), line: lineNo, column, endColumn: column + t.length });
          else if (!OPERATORS[t] && t !== '(' && t !== ')') problem(lineNo, column, column + t.length, `Unexpected '${t}' (only feature names and ! & | => <=> are supported).`);
        }
        return;
      }
      if (section !== 'features') { row.depth = 1; return; }

      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const parent = stack.at(-1);
      row.depth = parent ? parent.depth + 1 : 1;

      if (GROUP_HEADER.test(body)) {
        const owner = parent && parent.type === 'feature' ? parent : undefined;
        if (!owner) problem(lineNo, col, col + body.length, 'A group has to be indented below the feature it belongs to.');
        const g = { type: 'group', kind: /^\[/.test(body) ? 'cardinality' : body, text: body, line: lineNo, column: col, endColumn: col + body.length, indent, depth: row.depth, owner, children: [] };
        groups.push(g);
        owner?.groups.push(g);
        stack.push(g);
        return;
      }

      NAME.lastIndex = 0;
      const m = NAME.exec(body);
      if (!m) { problem(lineNo, col, col + body.length, `Expected a feature name, found '${body.slice(0, 20)}'.`); return; }
      const rest = body.slice(m[0].length).trim();
      if (rest && !/^\{[^}]*\}$/.test(rest)) problem(lineNo, col + m[0].length, col + body.length, `Unexpected '${rest}' after the feature name.`);
      const f = {
        type: 'feature', name: unquote(m[0]), line: lineNo, column: col, endColumn: col + m[0].length, indent, depth: row.depth,
        abstract: /\babstract\b/.test(rest), parent: parent && parent.type === 'group' ? parent : undefined, groups: [], lastLine: lineNo
      };
      if (parent && parent.type === 'feature') problem(lineNo, col, col + m[0].length, `'${f.name}' is under the feature '${parent.name}' with no group: write mandatory, optional, alternative, or or [m..n] between them.`);
      else if (!parent && features.length) problem(lineNo, col, col + m[0].length, 'A feature model has one root feature.');
      if (byName.has(f.name)) problem(lineNo, f.column, f.endColumn, `The feature '${f.name}' is declared twice (see line ${byName.get(f.name).line}).`);
      else byName.set(f.name, f);
      features.push(f);
      f.parent?.children.push(f);
      stack.push(f);
    });

    // the last line each feature and group reaches, for the outline
    const lastCode = rows.filter(r => !r.blank).map(r => r.line);
    const reach = item => {
      const children = item.type === 'feature' ? item.groups : item.children;
      let last = item.line;
      for (const child of children) last = Math.max(last, reach(child));
      item.lastLine = last;
      return last;
    };
    features.filter(f => !f.parent).forEach(reach);
    void lastCode;

    for (const g of groups) {
      if (!g.children.length) problem(g.line, g.column, g.endColumn, 'A group needs its features, indented below it.');
      else if (g.children.length === 1 && (g.kind === 'alternative' || g.kind === 'or')) problem(g.line, g.column, g.endColumn, `The ${g.kind} group of '${g.owner?.name ?? '?'}' has one feature: it is not a choice.`, 'warning');
    }
    for (const r of refs) if (!byName.has(r.name)) problem(r.line, r.column, r.endColumn, `The constraint uses '${r.name}', which is not a feature of the model.`);
    if (section !== undefined && !features.length && rows.some(r => r.body === undefined ? false : true)) { /* an empty model is reported by the grammar */ }

    return { lines, rows, features, groups, refs, problems, keywords, byName };
  };

  /** what is under the cursor: a feature (declared or used), a group header, an operator or a section word */
  const at = (model, { line, column }) => {
    for (const f of model.features) if (f.line === line && column >= f.column && column <= f.endColumn) return { kind: 'feature', feature: f, span: { line, column: f.column, endColumn: f.endColumn } };
    for (const r of model.refs) if (r.line === line && column >= r.column && column <= r.endColumn) return { kind: 'feature', feature: model.byName.get(r.name), name: r.name, span: { line, column: r.column, endColumn: r.endColumn } };
    for (const g of model.groups) if (g.line === line && column >= g.column && column <= g.endColumn) return { kind: 'group', group: g, span: { line, column: g.column, endColumn: g.endColumn } };
    for (const k of model.keywords) if (k.line === line && column >= k.column && column <= k.endColumn) return { kind: 'section', word: k.word, span: { line, column: k.column, endColumn: k.endColumn } };
    const row = model.rows.find(r => r.line === line);
    if (row && !row.blank && model.refs.some(r => r.line === line)) {
      const index = column - row.col;
      const m = [...row.body.matchAll(/<=>|=>|[!&|]/g)].find(x => index >= x.index && index <= x.index + x[0].length);
      if (m) return { kind: 'operator', operator: m[0], span: { line, column: row.col + m.index, endColumn: row.col + m.index + m[0].length } };
    }
    return undefined;
  };

  const occurrences = (model, feature) => [
    { line: feature.line, column: feature.column, endColumn: feature.endColumn },
    ...model.refs.filter(r => r.name === feature.name).map(r => ({ line: r.line, column: r.column, endColumn: r.endColumn }))
  ];

  const describeGroup = g => (g.kind === 'cardinality' ? `Cardinality ${g.text}: between the given number of the features below are chosen when the parent is in.` : GROUPS[g.kind]);

  const intelligence = {
    triggers: [' '],
    problems: text => scan(text).problems,

    hover(text, position) {
      const model = scan(text);
      const found = at(model, position);
      if (!found) return undefined;
      if (found.kind === 'section') return `**${found.word}**\n\n${SECTIONS[found.word]}`;
      if (found.kind === 'operator') return `**${found.operator}**\n\n${OPERATORS[found.operator]}`;
      if (found.kind === 'group') return `**${found.group.kind === 'cardinality' ? found.group.text : found.group.kind}**\n\n${describeGroup(found.group)}`;
      const f = found.feature;
      if (!f) return `**${found.name}**\n\nNot a feature of the model.`;
      const via = f.parent ? (f.parent.kind === 'cardinality' ? `in the ${f.parent.text} group` : `in a${f.parent.kind === 'optional' || f.parent.kind === 'alternative' ? 'n' : ''} ${f.parent.kind} group`) : 'the root feature';
      const owner = f.parent?.owner ? ` of **${f.parent.owner.name}**` : '';
      const used = model.refs.filter(r => r.name === f.name);
      const lines = [`**${f.name}**${f.abstract ? ' *(abstract)*' : ''} — ${f.parent ? `${via}${owner}` : via}`];
      const below = f.groups.reduce((n, g) => n + g.children.length, 0);
      if (below) lines.push(`${below} feature${below === 1 ? '' : 's'} below, in ${f.groups.map(g => (g.kind === 'cardinality' ? g.text : g.kind)).join(', ')}`);
      if (used.length) lines.push(`Used in ${used.length} constraint${used.length === 1 ? '' : 's'}: ${[...new Set(used.map(r => model.rows.find(x => x.line === r.line)?.body))].slice(0, 3).map(c => `\`${c}\``).join(', ')}`);
      return lines.join('\n\n');
    },

    definition(text, position) {
      const model = scan(text);
      const found = at(model, position);
      const f = found?.kind === 'feature' ? found.feature : undefined;
      return f ? { line: f.line, column: f.column, endColumn: f.endColumn } : undefined;
    },

    references(text, position) {
      const model = scan(text);
      const found = at(model, position);
      return found?.kind === 'feature' && found.feature ? occurrences(model, found.feature) : [];
    },

    prepareRename(text, position) {
      const model = scan(text);
      const found = at(model, position);
      if (!found || found.kind !== 'feature') return { message: 'Only a feature can be renamed.' };
      if (!found.feature) return { message: `'${found.name}' is not a feature of the model.` };
      return { span: found.span, text: found.feature.name };
    },

    rename(text, position, newName) {
      const model = scan(text);
      const found = at(model, position);
      const f = found?.kind === 'feature' ? found.feature : undefined;
      const wanted = newName.trim();
      if (!f || !wanted || (wanted !== f.name && model.byName.has(wanted))) return [];
      return occurrences(model, f).map(span => ({ span, text: formats.uvl.name(wanted) }));
    },

    symbols(text) {
      const model = scan(text);
      const length = line => (model.lines[line - 1]?.length ?? 0) + 1;
      const feature = f => ({
        name: f.name, detail: f.abstract ? 'abstract' : '', kind: 'symbol',
        span: { line: f.line, column: f.column, endColumn: f.endColumn },
        extent: { line: f.line, column: f.column, endLine: f.lastLine, endColumn: length(f.lastLine) },
        children: f.groups.map(g => ({
          name: g.kind === 'cardinality' ? g.text : g.kind, detail: `${g.children.length}`, kind: 'group',
          span: { line: g.line, column: g.column, endColumn: g.endColumn },
          extent: { line: g.line, column: g.column, endLine: g.lastLine, endColumn: length(g.lastLine) },
          children: g.children.map(feature)
        }))
      });
      const tree = model.features.filter(f => !f.parent).map(feature);
      const constraints = model.keywords.find(k => k.word === 'constraints');
      if (constraints) {
        const rows = model.rows.filter(r => !r.blank && r.line > constraints.line && model.refs.some(x => x.line === r.line));
        tree.push({
          name: 'constraints', detail: `${rows.length}`, kind: 'key', span: { line: constraints.line, column: 1, endColumn: constraints.endColumn },
          extent: { line: constraints.line, column: 1, endLine: rows.at(-1)?.line ?? constraints.line, endColumn: length(rows.at(-1)?.line ?? constraints.line) },
          children: rows.map(r => ({ name: r.body, kind: 'key', span: { line: r.line, column: r.col, endColumn: r.col + r.body.length } }))
        });
      }
      return tree;
    },

    complete(text, position) {
      const model = scan(text);
      const line = model.lines[position.line - 1] ?? '';
      const before = line.slice(0, position.column - 1);
      const row = model.rows.find(r => r.line === position.line);
      const lead = /^[ \t]*/.exec(line)[0];
      const typed = before.slice(lead.length);
      const indent = widthOf(lead);
      const section = [...model.keywords].reverse().find(k => k.line < position.line)?.word ?? (indent === 0 ? undefined : 'features');
      const name = text => formats.uvl.name(text);

      if (indent === 0 && !/\s/.test(before)) {
        const have = new Set(model.keywords.map(k => k.word));
        return ['features', 'constraints', 'namespace', 'include', 'imports'].filter(w => !have.has(w)).map(w => ({ label: w, kind: 'keyword', detail: SECTIONS[w] }));
      }
      if (section === 'constraints') {
        const operators = Object.keys(OPERATORS).map(o => ({ label: o, kind: 'operator', detail: OPERATORS[o] }));
        // a name is what comes first, or after an operator; an operator after a name
        const afterName = /(?:"[^"]*"|[A-Za-z_][\w#§%?\\'äüöß;]*)\s+$/.test(before);
        const names = model.features.map(f => ({ label: f.name, insert: name(f.name), kind: 'symbol', detail: f.parent ? `in ${f.parent.kind === 'cardinality' ? f.parent.text : f.parent.kind}${f.parent.owner ? ` of ${f.parent.owner.name}` : ''}` : 'root' }));
        return afterName ? operators.filter(o => o.label !== '!') : [...names, operators.find(o => o.label === '!')];
      }
      if (section !== 'features') return [];

      // a feature's attributes
      if (/^(?:"[^"]*"|[A-Za-z_][\w#§%?\\'äüöß;]*)\s+\{?\w*$/.test(typed) && !GROUP_HEADER.test(typed.trim())) {
        return [{ label: '{abstract}', kind: 'snippet', detail: 'An abstract feature has no code of its own: it only groups others.' }];
      }
      // what can come on a new line: below a feature, a group; below a group, features
      let owner;
      for (let i = model.rows.findIndex(r => r.line === position.line) - 1; i >= 0; i--) {
        const r = model.rows[i];
        if (r.blank || r.indent === undefined) continue;
        if (r.indent < indent || (row === undefined && i >= 0 && r.indent <= indent)) { owner = r; break; }
      }
      const ownerItem = owner && (model.features.find(f => f.line === owner.line) ?? model.groups.find(g => g.line === owner.line));
      if (ownerItem?.type === 'feature') {
        return [
          ...['mandatory', 'optional', 'alternative', 'or'].map(g => ({ label: g, kind: 'keyword', detail: GROUPS[g] })),
          { label: '[m..n]', insert: '[${1:1}..${2:*}]', kind: 'snippet', detail: 'Cardinality: between m and n of the features below are chosen.' }
        ];
      }
      return [];
    },

    format(text) {
      const model = scan(text);
      const out = [];
      let blank = false;
      // a comment line takes the level of the line that follows it
      const levelAfter = index => { for (let i = index + 1; i < model.rows.length; i++) if (!model.rows[i].blank) return model.rows[i].depth; return 0; };
      model.rows.forEach((row, index) => {
        if (row.blank && !row.comment) { blank = out.length > 0; return; }
        if (blank) { out.push(''); blank = false; }
        if (row.blank) { out.push('\t'.repeat(levelAfter(index)) + model.lines[row.line - 1].trim()); return; }
        const comment = /\s*(\/\/.*)$/.exec(model.lines[row.line - 1]);
        const code = row.body.replace(/\s+/g, ' ').replace(/\s*\{\s*/, ' {').replace(/\s*\}\s*$/, '}');
        out.push(`${'\t'.repeat(row.depth)}${code}${comment && code ? ` ${comment[1]}` : ''}`);
      });
      while (out.at(-1) === '') out.pop();
      return `${out.join('\n')}\n`;
    }
  };

  return { scan, at, intelligence };
})();

// How each format is coloured (line by line; the first rule that matches where a piece starts wins).
const UVL_RULES = [
  { match: /\/\/.*/, token: 'comment' },
  { match: /"[^"\r\n]*"/, token: 'string' },
  { match: /\b(?:features|constraints|include|imports|namespace|as|mandatory|optional|alternative|or|cardinality|abstract)\b/, token: 'keyword' },
  // a whole word is read at once, so that `as` inside `Extras` is not taken for the keyword (an editor matches from where it is, so \b is always there)
  { match: /[A-Za-z_][A-Za-z0-9_#§%?\\'äüöß;]*/, token: 'identifier' },
  { match: /\[\s*\d+(?:\s*\.\.\s*(?:\d+|\*))?\s*\]/, token: 'number' },
  { match: /<=>|=>|[!&|]/, token: 'operator' },
  { match: /[{}(),]/, token: 'delimiter' }
];
const XML_RULES = [
  { match: /<!--.*?-->/, token: 'comment' },
  { match: /<\?.*?\?>/, token: 'comment' },
  { match: /<\/?[A-Za-z_][\w:.-]*/, token: 'tag' },
  { match: /\/?>/, token: 'tag' },
  { match: /[A-Za-z_:][\w:.-]*(?==)/, token: 'attribute.name' },
  { match: /"[^"]*"/, token: 'attribute.value' }
];

/**
 * A view that shows the feature model as text in `format` and lets it be written there: what is typed is read, and when it is a feature
 * model it becomes the instance (through the metamodel's own import mapping), so the other views follow. The editor colours the text,
 * marks the line a mistake is on, and offers to copy the text, download it as a file, or fill it from one.
 */
const textView = (id, label, description, format, { language, rules, extension, mime, intelligence, indentAfter }) => ({
  id,
  label,
  description,
  formats,
  ...(intelligence ? { uvlTools } : {}),
  create(ctx, kit) {
    const { h } = kit;
    let state;
    let version = 0;
    let shown = '';
    let tree;

    const status = h('div', { style: 'font-size:12px;min-height:18px' });
    const host = h('div', { style: 'flex:1;min-height:0;position:relative' });
    const button = (text, title, onclick) => h('button', { title, onclick }, text);
    const file = h('input', { type: 'file', accept: `.${extension},${mime}`, style: 'display:none', onchange: async e => {
      const picked = e.target.files?.[0];
      e.target.value = '';
      if (picked) await apply(await picked.text(), true);
    } });
    const tools = h('div', { style: 'display:flex;gap:6px;align-items:center;font-size:12px' },
      h('span', { style: 'opacity:.7;flex:1' }, `The feature model as ${label}. Changes are applied as you type, when the text is valid.`),
      button('Copy', `Copy the ${label} to the clipboard`, async () => { await navigator.clipboard?.writeText(editor.getValue()); say('Copied', 'ok'); }),
      button('Download', `Save it as a .${extension} file`, () => {
        const link = h('a', { href: URL.createObjectURL(new Blob([editor.getValue()], { type: mime })), download: `${tree?.name ?? 'featuremodel'}.${extension}` });
        link.click();
        URL.revokeObjectURL(link.href);
      }),
      ...(intelligence ? [
        button('Outline', 'Go to a feature of the tree (Ctrl/Cmd+Shift+O)', () => editor.run('outline')),
        button('Find', 'Find in the text (Ctrl/Cmd+F)', () => editor.run('find')),
        button('Rename', 'Rename the feature under the cursor everywhere (F2)', () => editor.run('rename')),
        button('References', 'Where the feature under the cursor is used (Shift+F12)', () => editor.run('references')),
        button('Format', 'Tidy the indentation (Shift+Alt+F)', () => editor.run('format'))
      ] : []),
      button('Load…', `Replace the feature model with the one in a .${extension} file`, () => file.click()),
      file
    );
    const root = h('div', { style: 'display:flex;flex-direction:column;height:100%;box-sizing:border-box;padding:8px;gap:6px' }, tools, host, status);
    const say = (text, tone) => {
      status.textContent = text;
      status.style.color = tone === 'err' ? '#dc2626' : tone === 'ok' ? '#16a34a' : '';
    };

    const editor = kit.codeEditor(host, { language, rules, intelligence, indentAfter, onChange: value => apply(value, false), debounceMs: 500 });

    /** what the instance says, as text in this format (undefined when the instance cannot be read) */
    async function canonical() {
      const json = await ctx.engine.toJson(ctx.metamodel);
      tree = json?.featureModel;
      return tree ? format.print(tree) : undefined;
    }

    async function refresh() {
      const mine = ++version;
      let text;
      try { text = await canonical(); } catch (e) { say(e.message, 'err'); return; }
      if (mine !== version) return;
      if (text === undefined) { say('The feature model has errors that keep it from being shown here: fix them in the text view.', 'err'); return; }
      shown = text;
      // what is being typed is not replaced under the cursor
      if (!editor.hasFocus()) editor.setValue(text);
      editor.setProblems([]);
      const errors = (state?.problems ?? []).filter(p => p.severity === 'error');
      say(errors.length ? `${errors.length} error(s) in the feature model: ${errors[0].message}` : '', errors.length ? 'err' : undefined);
    }

    /** read `value` as a feature model and make it the instance; `replace` puts it in the editor too (a file that was loaded) */
    async function apply(value, replace) {
      const mine = ++version;
      let parsed;
      let text;
      try { parsed = format.parse(value); text = format.print(parsed); } catch (e) {
        const line = Number(/^line (\d+):/.exec(e.message)?.[1] ?? 1);
        editor.setProblems([{ message: e.message.replace(/^line \d+: /, ''), line }]);
        say(e.message, 'err');
        return;
      }
      editor.setProblems([]);
      // the same feature model as the one there is: nothing to change (and no loss of the layout the other views keep)
      if (text === shown && !replace) { say('', undefined); return; }
      const result = await ctx.engine.importJson({ featureModel: parsed });
      if (mine !== version) return;
      const built = result.texts[ctx.metamodel];
      if (!built) { say(result.errors.find(e => e.includes(ctx.metamodel)) ?? 'The feature model could not be built from this text.', 'err'); return; }
      await ctx.engine.setText(ctx.metamodel, built);
      if (replace) editor.setValue(text);
      say('Applied', 'ok');
    }

    return {
      mount(el) { el.appendChild(root); },
      update(next) { state = next; void refresh(); },
      reveal(range) { ctx.reveal(ctx.metamodel, range); },
      dispose() { editor.dispose(); root.remove(); }
    };
  }
});

const visualizations = [
  {
    id: 'feature-diagram',
    label: 'Feature diagram',
    description: 'The features as a tree, with mandatory, optional, alternative and or groups, and the constraints between them',
    create(ctx, kit) {
      const { h, svg } = kit;
      let features = [];
      let constraints = [];
      let selectedId;
      let inspected;
      let selectWhenDrawn;
      let messageTimer;

      const message = h('div', { class: 'bango-cmessage' });
      message.style.display = 'none';
      const say = text => {
        message.textContent = text;
        message.style.display = text ? '' : 'none';
        clearTimeout(messageTimer);
        if (text) messageTimer = setTimeout(() => say(''), 6000);
      };
      const edits = kit.editor(ctx.engine, ctx.metamodel, say);
      const list = h('ol', { class: 'bango-constraints', style: 'margin:6px 12px;font-family:ui-monospace,monospace;font-size:12px' });
      const button = (label, title, onclick) => h('button', { title, onclick }, label);

      const byId = id => features.find(f => f.id === id);
      const canvas = new kit.Canvas({
        onSelect: id => {
          selectedId = id ?? undefined;
          const picked = id === null ? undefined : byId(id);
          inspected = picked && JSON.stringify(picked.path);
          ctx.inspect(picked ? picked.path : null);
        },
        onOpen: id => {
          const picked = byId(id);
          if (picked?.node.range) ctx.reveal(ctx.metamodel, picked.node.range);
        },
        onDelete: async id => {
          const picked = byId(id);
          if (!picked) return;
          if (!picked.group) return say('The root feature cannot be removed.');
          if (await edits.remove(picked.path)) ctx.inspect(null);
        },
        onMove: positions => ctx.layout.set(positions)
      });

      /** a feature under the selected one, in its group of `kind` (made if it has none) */
      async function addChild(kind) {
        const parent = (selectedId && byId(selectedId)) ?? features[0];
        if (!parent) return say('This feature model has no root yet.');
        let groupPath = parent.groups.find(g => g.kind === kind)?.path;
        if (!groupPath) {
          groupPath = await edits.add(parent.path, 'groups', 'Group');
          if (!groupPath || !(await edits.set(groupPath, 'kind', kind))) return;
        }
        const name = freshName(new Set(features.map(f => f.name)), 'Feature');
        if (await edits.addNamed(groupPath, 'features', 'Feature', name)) selectWhenDrawn = name;
      }

      /** every feature with where it is in the instance, parents first */
      function read(ast) {
        const out = [];
        const visit = (node, path, parent, group, mark) => {
          const entry = { node, id: node.name, name: node.name, path, parent, group, mark, abstract: !!node.props.abstract, groups: [] };
          out.push(entry);
          many(node.children.groups).forEach((g, gi) => {
            const groupPath = [...path, { feature: 'groups', index: gi }];
            const kind = g.props.kind ?? 'cardinality';
            const mark = g.props.kind ? KIND_MARK[g.props.kind] : cardinalityText(g);
            entry.groups.push({ kind, path: groupPath });
            many(g.children.features).forEach((child, ci) => visit(child, [...groupPath, { feature: 'features', index: ci }], entry, kind, mark));
          });
        };
        const root = many(ast?.children.root)[0];
        if (root) visit(root, [{ feature: 'root' }], undefined, undefined);
        return out;
      }

      function nodeOf(f) {
        const label = f.name.replace(/^"|"$/g, '');
        const width = Math.max(90, label.length * CHAR + 24);
        const color = f.group ? KIND_COLOR[f.group] : '#8b5cf6';
        const el = svg('g', {},
          svg('rect', { width, height: HEIGHT, rx: 5, style: `fill:var(--bango-panel,#252526);stroke:${color};stroke-width:1.5${f.abstract ? ';stroke-dasharray:4 2' : ''}` }),
          svg('text', { x: width / 2, y: 19, 'text-anchor': 'middle', 'font-size': 12, ...(f.abstract ? { 'font-style': 'italic' } : {}) }, label)
        );
        return { id: f.id, el, width, height: HEIGHT };
      }

      function edgesOf() {
        return features.filter(f => f.parent).map(f => ({
          id: `${f.parent.id}>${f.id}`,
          from: f.parent.id,
          to: f.id,
          color: KIND_COLOR[f.group],
          dashed: f.group === 'optional' || f.group === 'or',
          label: f.mark
        }));
      }

      function draw() {
        const sizes = features.map(nodeOf);
        const saved = ctx.layout.get();
        const current = new Set(features.map(f => f.id));
        canvas.render(sizes, edgesOf(), saved, { direction: 'down', hierarchy: features.filter(f => f.parent).map(f => [f.parent.id, f.id]) });
        if (selectWhenDrawn && current.has(selectWhenDrawn)) {
          canvas.select(selectWhenDrawn);
          selectWhenDrawn = undefined;
        } else if (inspected) {
          const same = features.find(f => JSON.stringify(f.path) === inspected);
          if (same && canvas.selected !== same.id) canvas.select(same.id);
        }
        list.replaceChildren(...constraints.map(c => h('li', {}, c)));
      }

      canvas.toolbar.append(
        button('+ Mandatory', 'Add a mandatory feature under the selected one', () => void addChild('mandatory')),
        button('+ Optional', 'Add an optional feature under the selected one', () => void addChild('optional')),
        button('+ Alternative', 'Add a feature to the alternative (choose exactly one) of the selected one', () => void addChild('alternative')),
        button('+ Or', 'Add a feature to the or group (choose at least one) of the selected one', () => void addChild('or')),
        // a cardinality group is made in the form (its bounds are written there); the diagram shows it as [m..n]
        h('span', { class: 'bango-spacer' }),
        button('Auto layout', 'Place the nodes again', () => canvas.autoLayout({ direction: 'down', hierarchy: features.filter(f => f.parent).map(f => [f.parent.id, f.id]) })),
        button('Fit', 'Show everything', () => canvas.fit()),
        button('−', 'Zoom out', () => canvas.zoom(1 / 1.25)),
        button('+', 'Zoom in', () => canvas.zoom(1.25))
      );

      return {
        mount(el) {
          canvas.mount(el);
          canvas.el.appendChild(message);
          canvas.el.appendChild(list);
        },

        update(next) {
          features = read(next.ast);
          constraints = many(next.ast?.children.constraints).map(constraintText);
          draw();
        },

        reveal(range) {
          ctx.reveal(ctx.metamodel, range);
        },

        dispose() {
          clearTimeout(messageTimer);
          canvas.dispose();
        }
      };
    }
  },
  textView('uvl', 'UVL', 'The feature model as UVL text, to read and write', formats.uvl, { language: 'uvl', rules: UVL_RULES, extension: 'uvl', mime: 'text/plain', intelligence: uvlTools.intelligence, indentAfter: /^\s*(?:features|constraints|mandatory|optional|alternative|or|\[[^\]]*\])\s*$/ }),
  textView('xml', 'XML', 'The feature model as FeatureIDE XML, to read and write', formats.xml, { language: 'xml', rules: XML_RULES, extension: 'xml', mime: 'application/xml' })
];

return visualizations;
