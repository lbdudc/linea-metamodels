// Which nodes a reference can point at, from where it is written: { NodeType: { referenceFeature(node) { return [...nodes]; } } }
// The columns and the sort field of a list are fields of its entity. While the entity does not resolve (that is reported on its own),
// there is nothing to resolve them against.
const fieldsOf = (entity, seen = new Set()) => (entity && !seen.has(entity) ? [...(entity.fields ?? []), ...fieldsOf(entity.superclass?.ref, seen.add(entity))] : []);

/** @type {Scope} */
const scope = {
  ListDef: {
    sortBy: list => fieldsOf(list.entity?.ref)
  },
  ListColumn: {
    property: column => fieldsOf(column.$container.entity?.ref)
  }
};

return scope;
