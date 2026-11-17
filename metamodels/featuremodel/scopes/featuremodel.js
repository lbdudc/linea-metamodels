// A constraint can name any feature of the tree, at any depth (by default only the siblings of a node are in sight).
/** @type {Scope} */
const scope = {
  Operand: {
    feature: ref => {
      /** @type {any} the climb passes through every kind of node */
      let node = ref;
      while (node && node.$type !== 'FeatureTree') node = node.$container;
      if (!node) return undefined;
      const out = [];
      const walk = feature => { out.push(feature); feature.groups.forEach(g => g.features.forEach(walk)); };
      walk(node.root);
      return out;
    }
  }
};

return scope;
