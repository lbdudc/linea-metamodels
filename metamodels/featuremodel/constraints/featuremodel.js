// Rules the grammar cannot express: feature names are unique (and can be written in UVL), and groups that can mean something.
const unq = text => (/^["']/.test(text) ? text.slice(1, -1) : text);

/** @type {Constraints} */
const constraints = {
  FeatureTree(model, accept) {
    const all = [];
    const walk = feature => { all.push(feature); feature.groups.forEach(g => g.features.forEach(walk)); };
    // (a model that does not parse may not have its root)
    if (model.root) walk(model.root);
    for (const { item } of duplicates(all, f => unq(f.name))) accept('error', `duplicate feature '${unq(item.name)}'`, { node: item, property: 'name' });
    // UVL writes a name that is not a plain word between double quotes, and cannot have a dot or a quote in it
    for (const feature of all) {
      if (/[.\"\r\n]/.test(unq(feature.name))) accept('warning', `'${unq(feature.name)}' cannot be written in UVL: a feature name cannot have a dot, a quote or a line break`, { node: feature, property: 'name' });
    }
  },

  Group(group, accept) {
    const parent = unq(group.$container.name);
    const what = group.kind ?? 'cardinality';
    if (!group.features.length) accept('warning', `the ${what} group of '${parent}' has no features: it is left out of the UVL`, { node: group });
    else if (group.features.length < 2 && (group.kind === 'alternative' || group.kind === 'or')) {
      accept('warning', `the ${what} group of '${parent}' has one feature: it is not a choice`, { node: group });
    }
    if (group.kind === undefined) {
      const min = group.min ?? 0;
      const max = group.unbounded ? Infinity : (group.max ?? min);
      if (max < min) accept('error', `the cardinality [${min}..${max}] of '${parent}' is empty: the most is below the least`, { node: group });
      else if (min > group.features.length) accept('error', `the cardinality of '${parent}' asks for at least ${min}, but the group has ${group.features.length} feature(s)`, { node: group });
    }
  }
};

return constraints;
