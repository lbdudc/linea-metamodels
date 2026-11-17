// Visualizations of the feature selection: the views of a featureselection instance that only this metamodel knows how to draw.
// The file is the body of a function that returns them; `kit` is what bango gives to draw with (a canvas, SVG helpers, tree edits).
//
// Feature tree: the feature model of the SPL (offered to the product, read-only) as a tree of checkboxes. Click a box to select a feature,
// again to deselect it, again to leave it open. A feature the selection needs (its ancestors, what is mandatory under a selected feature)
// is shown as implied. Groups say what they ask for (exactly one of an alternative, at least one of an or), and what is wrong with the
// selection is listed at the top.

const GROUP_LABEL = { mandatory: 'mandatory', optional: 'optional', alternative: 'choose exactly one', or: 'choose at least one' };

/** what a group asks for; a cardinality group `[m..n]` says how many */
const groupLabel = g => {
  if (g.kind) return GROUP_LABEL[g.kind] ?? g.kind;
  const { min, max, unbounded } = g.props;
  return unbounded ? `choose at least ${min}` : max === undefined || max === min ? `choose exactly ${min}` : `choose between ${min} and ${max}`;
};

/** a child of a node is one node or a list of them: always a list */
const many = value => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const unq = text => (/^["']/.test(text) ? text.slice(1, -1) : text);

// The constraints of the feature model, as formulas over the names of features (from the tree of the model, not from the text):
// { feature }, { not }, { operator, left, right }. A chain is read with & before | before => before <=>, all to the left, as in UVL.
const PRECEDENCE = { '<=>': 1, '=>': 2, '|': 3, '&': 4 };
const formulaOfDto = constraint => {
  const operand = o => {
    const inner = many(o.children.inner)[0];
    const base = inner ? formulaOfDto(inner) : { feature: many(o.refs.feature)[0]?.text };
    return o.props.negated ? { not: base } : base;
  };
  const operands = [many(constraint.children.first)[0], ...many(constraint.children.links).map(l => many(l.children.operand)[0])].map(operand);
  const operators = many(constraint.children.links).map(l => l.props.operator);
  let at = 0;
  const climb = least => {
    let left = operands[at];
    while (at < operators.length && PRECEDENCE[operators[at]] >= least) {
      const operator = operators[at++];
      left = { operator, left, right: climb(PRECEDENCE[operator] + 1) };
    }
    return left;
  };
  return climb(1);
};

const holds = (formula, on) => {
  if (formula.feature !== undefined) return on.has(formula.feature);
  if (formula.not !== undefined) return !holds(formula.not, on);
  const [l, r] = [holds(formula.left, on), holds(formula.right, on)];
  return formula.operator === '&' ? l && r : formula.operator === '|' ? l || r : formula.operator === '=>' ? !l || r : l === r;
};

/** What a constraint leaves no choice about (see the `featureselection` JSON mapping): the names of the features that have to be there for it to hold. */
const needs = (formula, on, out, add) => {
  if (holds(formula, on) && formula.operator !== '=>' && formula.operator !== '&') return;
  if (formula.feature !== undefined) add(formula.feature);
  else if (formula.operator === '&') { needs(formula.left, on, out, add); needs(formula.right, on, out, add); }
  else if (formula.operator === '=>') { if (holds(formula.left, on)) needs(formula.right, on, out, add); }
  else if (formula.operator === '<=>') {
    if (holds(formula.left, on)) needs(formula.right, on, out, add);
    if (holds(formula.right, on)) needs(formula.left, on, out, add);
  } else if (formula.operator === '|') {
    const alternatives = f => (f.operator === '|' ? [...alternatives(f.left), ...alternatives(f.right)] : [f]);
    const open = alternatives(formula).filter(d => !(d.not?.feature !== undefined && on.has(d.not.feature)) && !(d.feature !== undefined && out.has(d.feature)));
    if (open.length === 1) needs(open[0], on, out, add);
  }
};

const visualizations = [
  {
    id: 'feature-tree',
    label: 'Feature tree',
    description: 'The feature model as a tree of checkboxes: select what the product has',
    create(ctx, kit) {
      const { h } = kit;
      const edits = kit.editor(ctx.engine, ctx.metamodel, text => say(text));
      const collapsed = new Set();
      let filter = '';
      let state;
      let model;

      const root = h('div', { class: 'bango-feature-tree', style: 'padding:8px 12px;overflow:auto;height:100%;box-sizing:border-box;font-size:13px' });
      const status = h('div', { class: 'bango-ftstatus' });
      const tools = h('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:8px' });
      const search = h('input', { type: 'search', placeholder: 'Filter features', style: 'flex:1;min-width:0', oninput: e => { filter = e.target.value.trim().toLowerCase(); draw(); } });
      const body = h('div', { class: 'bango-ftbody' });
      const message = h('div', { style: 'color:var(--bango-warn,#d97706);margin:4px 0;display:none' });
      const say = text => {
        message.textContent = text;
        message.style.display = text ? '' : 'none';
      };
      tools.append(
        search,
        h('button', { title: 'Open every group', onclick: () => { collapsed.clear(); draw(); } }, 'Expand'),
        h('button', { title: 'Close every group', onclick: () => { for (const f of features()) if (f.groups.length) collapsed.add(f.name); draw(); } }, 'Collapse')
      );
      root.append(tools, status, message, body);

      /** the feature model offered to this selection, as a tree with where each node is */
      const offeredModel = () => state?.offered.find(o => o.metamodel === 'featuremodel' && o.available && o.ast);

      function readModel(ast) {
        const visit = (node, parent, group) => {
          const entry = { node, name: node.name, parent, group, abstract: !!node.props.abstract, groups: [] };
          for (const g of many(node.children.groups)) {
            entry.groups.push({ kind: g.props.kind, props: g.props, features: many(g.children.features).map(c => visit(c, entry, g.props.kind ?? 'cardinality')) });
          }
          return entry;
        };
        const top = many(ast?.children.root)[0];
        return top && { name: ast.name, root: visit(top, undefined, undefined), constraints: many(ast.children.constraints).map(c => { try { return formulaOfDto(c); } catch (e) { return undefined; } }).filter(Boolean) };
      }

      const features = () => {
        const out = [];
        const walk = f => { out.push(f); f.groups.forEach(g => g.features.forEach(walk)); };
        if (model) walk(model.root);
        return out;
      };

      /** the choices of the selection, by feature name */
      function choices() {
        const out = new Map();
        many(state?.ast?.children.choices).forEach((node, index) => {
          const ref = many(node.refs.feature)[0];
          if (ref) out.set(ref.targetName ?? ref.text, { selected: !!node.props.selected, path: [{ feature: 'choices', index }], index });
        });
        return out;
      }

      /** the selected features once what the model implies is added: the root, ancestors, what is mandatory under a selected one, and what the constraints need */
      function complete(chosen) {
        const selected = new Set();
        const byName = new Map(features().map(f => [f.name, f]));
        const out = new Set([...chosen].filter(([, c]) => !c.selected).map(([name]) => name));
        let changed = true;
        const add = f => { if (f && !selected.has(f)) { selected.add(f); changed = true; } };
        const addByName = name => add(byName.get(name));
        add(model.root);
        for (const f of features()) if (chosen.get(f.name)?.selected) add(f);
        while (changed) {
          changed = false;
          for (const f of [...selected]) { add(f.parent); for (const g of f.groups) if (g.kind === 'mandatory') g.features.forEach(add); }
          const on = new Set([...selected].map(f => f.name));
          for (const formula of model.constraints) { try { needs(formula, on, out, addByName); } catch (e) { /* a constraint on a feature that is not there */ } }
        }
        return selected;
      }

      /** select, deselect, or leave open: the next step for a feature */
      async function cycle(feature, chosen) {
        const current = chosen.get(feature.name);
        say('');
        if (!current) {
          const path = await edits.add([], 'choices', 'Choice');
          if (path && (await edits.set(path, 'feature', feature.name))) await edits.set(path, 'selected', true);
        } else if (current.selected) {
          await edits.set(current.path, 'selected', false);
        } else {
          await edits.remove(current.path);
        }
      }

      async function useModel(name) {
        await edits.set([], 'model', name);
      }

      function row(feature, chosen, selected, depth) {
        const choice = chosen.get(feature.name);
        const implied = selected.has(feature) && !choice?.selected;
        const isRoot = !feature.parent;
        const box = h('input', { type: 'checkbox', disabled: isRoot, onclick: e => { e.preventDefault(); void cycle(feature, chosen); } });
        box.checked = selected.has(feature);
        box.indeterminate = false;
        box.title = choice ? (choice.selected ? 'Selected: click to deselect' : 'Deselected: click to leave it open') : implied ? 'Implied by the selection: click to select it' : 'Click to select';
        const label = h('span', { style: `${choice && !choice.selected ? 'text-decoration:line-through;opacity:.6;' : ''}${implied ? 'opacity:.75;' : ''}${feature.abstract ? 'font-style:italic;' : ''}` }, unq(feature.name));
        const tags = [
          choice && !choice.selected && h('span', { style: 'color:#dc2626;font-size:11px' }, 'deselected'),
          implied && h('span', { style: 'opacity:.55;font-size:11px' }, 'implied')
        ].filter(Boolean);
        const toggle = feature.groups.length
          ? h('span', { style: 'cursor:pointer;width:14px;display:inline-block', onclick: () => { collapsed.has(feature.name) ? collapsed.delete(feature.name) : collapsed.add(feature.name); draw(); } }, collapsed.has(feature.name) ? '▸' : '▾')
          : h('span', { style: 'width:14px;display:inline-block' });
        return h('div', { style: `display:flex;gap:6px;align-items:center;padding:2px 0 2px ${depth * 18}px` }, toggle, box, label, ...tags);
      }

      function draw() {
        const found = offeredModel();
        model = found && readModel(found.ast);
        body.replaceChildren();
        status.replaceChildren();

        if (!model) {
          body.append(h('p', { style: 'opacity:.7' }, found ? 'The feature model has no root feature.' : 'There is no feature model to choose from. Configure the SPL first.'));
          return;
        }

        // the selection names a model: if it does not, offer the one there is
        const named = many(state.ast?.refs.model)[0];
        if (!named || named.resolved === false) {
          status.append(h('div', { style: 'margin:4px 0' }, `This selection is not of any feature model yet. `, h('button', { onclick: () => void useModel(model.name) }, `Use ${unq(model.name)}`)));
        }

        const problems = (state.problems ?? []).filter(p => p.severity === 'error');
        if (problems.length) {
          status.append(h('ul', { style: 'margin:4px 0;padding-left:18px;color:#dc2626' }, ...problems.map(p => h('li', {}, p.message))));
        } else if (state.ast) {
          status.append(h('div', { style: 'margin:4px 0;color:#16a34a' }, 'The selection is valid.'));
        }

        const chosen = choices();
        const selected = complete(chosen);
        const visible = filter
          ? new Set(features().filter(f => unq(f.name).toLowerCase().includes(filter)).flatMap(f => { const up = []; for (let x = f; x; x = x.parent) up.push(x); return up; }))
          : undefined;

        const render = (feature, depth) => {
          if (visible && !visible.has(feature)) return;
          body.append(row(feature, chosen, selected, depth));
          if (collapsed.has(feature.name) && !visible) return;
          for (const group of feature.groups) {
            const shown = group.features.filter(f => !visible || visible.has(f));
            if (!shown.length) continue;
            body.append(h('div', { style: `padding:2px 0 0 ${(depth + 1) * 18 + 20}px;font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.04em` }, groupLabel(group)));
            shown.forEach(f => render(f, depth + 2));
          }
        };
        render(model.root, 0);
      }

      return {
        mount(el) {
          el.appendChild(root);
        },

        update(next) {
          state = next;
          draw();
        },

        reveal(range) {
          ctx.reveal(ctx.metamodel, range);
        },

        dispose() {
          root.remove();
        }
      };
    }
  }
];

return visualizations;
