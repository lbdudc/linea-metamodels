// A selection is valid when, once completed with what the model implies (its tree, and the constraints that leave no choice), every group is respected and every constraint holds.
const unq = text => (/^["']/.test(text) ? text.slice(1, -1) : text);

/** every feature of the model, parents first */
const featuresOf = model => {
  const out = [];
  const walk = feature => { out.push(feature); feature.groups.forEach(g => g.features.forEach(walk)); };
  walk(model.root);
  return out;
};

const parentOf = feature => (feature.$container.$type === 'Group' ? feature.$container.$container : undefined);

// The formula of a constraint as a tree, from the chain it is written as: & binds tightest, then |, then =>, then <=> (all group to the left, as in UVL).
const PRECEDENCE = { '<=>': 1, '=>': 2, '|': 3, '&': 4 };
const formulaOf = constraint => {
  const operand = o => {
    const base = o.inner ? formulaOf(o.inner) : { feature: o.feature };
    return o.negated ? { not: base } : base;
  };
  const operands = [constraint.first, ...constraint.links.map(l => l.operand)].map(operand);
  const operators = constraint.links.map(l => l.operator);
  let at = 0;
  const climb = least => {
    let left = operands[at];
    while (at < operators.length && PRECEDENCE[operators[at]] >= least) {
      const operator = operators[at++];
      const right = climb(PRECEDENCE[operator] + 1);
      left = { operator, left, right };
    }
    return left;
  };
  return climb(1);
};

const truth = (formula, selected) => {
  if (formula.feature !== undefined) return selected.has(formula.feature.ref);
  if (formula.not !== undefined) return !truth(formula.not, selected);
  const [l, r] = [truth(formula.left, selected), truth(formula.right, selected)];
  return formula.operator === '&' ? l && r : formula.operator === '|' ? l || r : formula.operator === '=>' ? !l || r : l === r;
};

/**
 * What a constraint leaves no choice about: the features that have to be there for it to hold, given what is selected. `A => B` with A selected
 * needs B; `!A | B` is the same thing written as a clause; a constraint that is a feature on its own makes it mandatory. Where there is a choice
 * (an `|` of two features that are both open) nothing is added: it is the selection's to say.
 */
const establish = (formula, selected, deselected, add) => {
  if (truth(formula, selected)) {
    // it holds, but what it says of a feature that is selected can still need more (A => B & C)
    if (formula.operator !== '=>' && formula.operator !== '&') return;
  }
  if (formula.feature !== undefined) add(formula.feature.ref);
  else if (formula.operator === '&') { establish(formula.left, selected, deselected, add); establish(formula.right, selected, deselected, add); }
  else if (formula.operator === '=>') { if (truth(formula.left, selected)) establish(formula.right, selected, deselected, add); }
  else if (formula.operator === '<=>') {
    if (truth(formula.left, selected)) establish(formula.right, selected, deselected, add);
    if (truth(formula.right, selected)) establish(formula.left, selected, deselected, add);
  } else if (formula.operator === '|') {
    const alternatives = f => (f.operator === '|' ? [...alternatives(f.left), ...alternatives(f.right)] : [f]);
    // a feature that is out, or the negation of one that is in, cannot make the formula hold: when only one way is left, it is taken
    const open = alternatives(formula).filter(d => !(d.not?.feature !== undefined && selected.has(d.not.feature.ref)) && !(d.feature !== undefined && deselected.has(d.feature.ref)));
    if (open.length === 1) establish(open[0], selected, deselected, add);
  }
};

/** The selected features once what the model implies is added: the root, the ancestors of what is chosen, what is mandatory, and what the constraints need. */
const complete = (model, chosen, deselected) => {
  const selected = new Set([model.root, ...chosen]);
  const formulas = [];
  for (const constraint of model.constraints) { try { formulas.push(formulaOf(constraint)); } catch (e) { /* a constraint that names a feature that does not resolve is reported in the model */ } }
  for (let changed = true; changed;) {
    changed = false;
    const add = f => { if (f && !selected.has(f)) { selected.add(f); changed = true; } };
    for (const feature of [...selected]) {
      add(parentOf(feature));
      for (const group of feature.groups) if (group.kind === 'mandatory') group.features.forEach(add);
    }
    for (const formula of formulas) { try { establish(formula, selected, deselected, add); } catch (e) { /* the same */ } }
  }
  return selected;
};

const show = formula => {
  if (formula.feature !== undefined) return unq(formula.feature.$refText);
  if (formula.not !== undefined) return `!${show(formula.not)}`;
  return `(${show(formula.left)} ${formula.operator} ${show(formula.right)})`;
};

/** the least and the most features a cardinality group `[m..n]` lets a product have; `max` is Infinity when there is none */
const boundsOf = group => ({ min: group.min ?? 0, max: group.unbounded ? Infinity : (group.max ?? group.min ?? 0) });

/** @type {Constraints} */
const constraints = {
  Selection(selection, accept) {
    const model = selection.model?.ref;
    if (!model || !model.root) return;
    // the choices whose feature resolves, with that feature
    const ok = selection.choices.flatMap(choice => (choice.feature.ref ? [{ choice, feature: choice.feature.ref }] : []));

    for (const { item } of duplicates(ok, c => c.feature.name)) {
      const first = ok.find(c => c.feature === item.feature);
      accept('error', first?.choice.selected === item.choice.selected ? `'${unq(item.choice.feature.$refText)}' is chosen twice` : `'${unq(item.choice.feature.$refText)}' is both selected and deselected`, { node: item.choice, property: 'feature' });
    }
    const chosen = ok.filter(c => c.choice.selected).map(c => c.feature);

    const deselected = new Set(ok.filter(c => !c.choice.selected).map(c => c.feature));
    const selected = complete(model, chosen, deselected);
    for (const { choice, feature } of ok) {
      if (!choice.selected && selected.has(feature)) accept('error', `'${unq(choice.feature.$refText)}' is deselected, but the selection needs it`, { node: choice, property: 'feature' });
    }

    for (const feature of featuresOf(model)) {
      if (!selected.has(feature)) continue;
      for (const group of feature.groups) {
        if (group.kind === 'mandatory' || group.kind === 'optional') continue;
        const count = group.features.filter(f => selected.has(f)).length;
        const names = group.features.map(f => unq(f.name)).join(', ');
                const parent = unq(feature.name);
        if (group.kind === 'alternative' && count !== 1) accept('error', `choose exactly one of ${names} (${count} selected) for '${unq(feature.name)}'`, { node: selection, property: 'model' });
        else if (group.kind === 'or' && count < 1) accept('error', `choose at least one of ${names} for '${parent}'`, { node: selection, property: 'model' });
        else if (group.kind === undefined) {
          const { min, max } = boundsOf(group);
          if (count >= min && count <= max) continue;
          accept('error', `choose ${max === Infinity ? `at least ${min}` : min === max ? `exactly ${min}` : `between ${min} and ${max}`} of ${names} (${count} selected) for '${parent}'`, { node: selection, property: 'model' });
        }
      }
    }

    for (const constraint of model.constraints) {
      try {
        const formula = formulaOf(constraint);
        if (!truth(formula, selected)) accept('error', `the constraint ${show(formula)} does not hold`, { node: selection, property: 'model' });
      } catch (e) { /* a constraint that names a feature that does not resolve is reported in the model */ }
    }
  }
};

return constraints;
