// JSON mapping: the feature model as a tree, and its constraints as formulas.
//   { featureModel: { name, root: { name, abstract?, groups: [{ kind, min?, max?, features: [...] }] }, constraints: [formula] } }
// `kind` is mandatory, optional, alternative, or, or cardinality (with `min`, and `max` unless it is unbounded).
// A formula is { feature }, { not }, or { operator: '&' | '|' | '=>' | '<=>', left, right }.
/** @type {Spec} */
const spec = function (model) {
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

  // a name written in quotes comes with them
  const unq = text => (/^["']/.test(text) ? text.slice(1, -1).replace(/\\(.)/g, '$1') : text);

  const feature = f => {
    const out = { name: unq(f.name) };
    if (f.abstract) out.abstract = true;
    out.groups = f.groups.map(g => {
      const features = g.features.map(feature);
      // a cardinality group `[m..n]`: `max` is left out when there is none, and is `m` for `[m]`
      if (g.kind !== undefined) return { kind: g.kind, features };
      return { kind: 'cardinality', min: g.min, ...(g.unbounded ? {} : { max: g.max ?? g.min }), features };
    });
    return out;
  };

  const plain = f => {
    if (f.feature !== undefined) return { feature: unq(f.feature.$refText) };
    if (f.not !== undefined) return { not: plain(f.not) };
    return { operator: f.operator, left: plain(f.left), right: plain(f.right) };
  };
  const formula = c => plain(formulaOf(c));

  // a model that does not parse may not have its root: there is nothing to say of it
  if (!model.root) return {};
  return { featureModel: { name: unq(model.name), root: feature(model.root), constraints: model.constraints.map(formula) } };
};

return spec;
