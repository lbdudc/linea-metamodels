// Import mapping: the inverse of featuremodel.spec.js. Builds the feature model from `featureModel`.
/** @type {Import} */
const importer = function (json, { n }) {
  const fm = json.featureModel;
  // the JSON of a product does not carry its SPL's feature model: nothing to build then
  if (!fm) return undefined;
  // a name that is not a plain word, or is a word of the grammar, is written in quotes (its uses are written the same way)
  const WORDS = ['featuremodel', 'feature', 'abstract', 'mandatory', 'optional', 'alternative', 'or', 'constraints', 'selection', 'of', 'select', 'deselect'];
  const q = text => (/^[_a-zA-Z\u00C0-\u024F][\w\u00C0-\u024F_-]*$/.test(text) && !WORDS.includes(text) ? text : JSON.stringify(text));

  const group = g => {
    const features = g.features.map(feature);
    if (g.kind !== 'cardinality') return n('Group', { kind: g.kind, features });
    // `[m..m]` is written `[m]`
    const exact = g.max === g.min;
    return n('Group', { min: g.min, max: g.max !== undefined && !exact ? g.max : undefined, unbounded: g.max === undefined ? true : undefined, features });
  };

  const feature = f => n('Feature', { name: q(f.name), abstract: f.abstract, groups: (f.groups ?? []).map(g => group(g)) });

  // compound operands are always in parentheses, so the chain means the tree whatever the precedence is
  const operand = (f, negated) => {
    if (f.not !== undefined) return operand(f.not, !negated);
    if (f.feature !== undefined) return n('Operand', { negated: negated || undefined, feature: q(f.feature) });
    return n('Operand', { negated: negated || undefined, inner: chain(f) });
  };
  const chain = f => {
    if (f.operator === undefined) return n('Constraint', { first: operand(f, false), links: [] });
    return n('Constraint', { first: operand(f.left, false), links: [n('Link', { operator: f.operator, operand: operand(f.right, false) })] });
  };
  const formula = chain;

  return n('FeatureTree', { name: q(fm.name), root: feature(fm.root), constraints: (fm.constraints ?? []).map(formula) });
};

return importer;
