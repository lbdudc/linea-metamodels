// A choice can only name a feature of the model the selection is of.
const featuresOf = model => {
  const out = [];
  const walk = feature => { out.push(feature); feature.groups.forEach(g => g.features.forEach(walk)); };
  if (model?.root) walk(model.root);
  return out;
};

/** @type {Scope} */
const scope = {
  Choice: {
    // while the model does not resolve (that is reported on its own) there is nothing to choose from
    feature: choice => (choice.$container.model?.ref ? featuresOf(choice.$container.model.ref) : undefined)
  }
};

return scope;
