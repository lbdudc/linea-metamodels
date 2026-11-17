// Import mapping: the inverse of featureselection.spec.js. Builds a selection from `features`, of the feature model the JSON carries
// (`featureModel`, which the JSON of a product does not: the model belongs to the SPL, so there is no selection to build from it alone).
/** @type {Import} */
const importer = function (json, { n }) {
  if (!json.featureModel || !json.features) return undefined;
  // a name that is not a plain word, or is a word of the grammar, is written in quotes (its uses are written the same way)
  const WORDS = ['featuremodel', 'feature', 'abstract', 'mandatory', 'optional', 'alternative', 'or', 'constraints', 'selection', 'of', 'select', 'deselect'];
  const q = text => (/^[_a-zA-Z\u00C0-\u024F][\w\u00C0-\u024F_-]*$/.test(text) && !WORDS.includes(text) ? text : JSON.stringify(text));
  return n('Selection', { model: q(json.featureModel.name), choices: json.features.map(f => n('Choice', { selected: true, feature: q(f) })) });
};

return importer;
