// JSON mapping: the product's features, `features`: what it chose and what the feature model implies (its tree, and the constraints that leave
// no choice), in the model's order.
// (The slot is empty in `basic`: this is where the feature selection of a product goes in the specification.)
/** @type {Spec} */
const spec = function (model) {
  // a name written in quotes comes with them
  const unq = text => (/^["']/.test(text) ? text.slice(1, -1).replace(/\\(.)/g, '$1') : text);

  const tree = model.model?.ref;
  const chosen = model.choices.flatMap(c => (c.selected && c.feature.ref ? [c.feature.ref] : []));
  if (!tree || !tree.root) return { features: [...new Set(model.choices.filter(c => c.selected).map(c => unq(c.feature.$refText)))] };

  const order = [];
  const walk = f => { order.push(f); f.groups.forEach(g => g.features.forEach(walk)); };
  walk(tree.root);

  const parentOf = f => (f.$container.$type === 'Group' ? f.$container.$container : undefined);
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

  const deselected = new Set(model.choices.flatMap(c => (!c.selected && c.feature.ref ? [c.feature.ref] : [])));
  const selected = complete(tree, chosen, deselected);
  return { features: order.filter(f => selected.has(f)).map(f => unq(f.name)) };
};

return spec;
