// Which nodes a reference can point at, from where it is written: { NodeType: { referenceFeature(node) { return [...nodes]; } } }
// The fields of a form are the fields of its entity, its own and the ones it takes from the entities it extends. (Return undefined
// to leave the choice to the default scope, which is every exported node of the right type: that is not what is wanted for fields,
// which belong to their entity.)
const fieldsOf = (entity, seen = new Set()) => (entity && !seen.has(entity) ? [...(entity.fields ?? []), ...fieldsOf(entity.superclass?.ref, seen.add(entity))] : []);

/** @type {Scope} */
const scope = {
  FormField: {
    property: field => fieldsOf(field.$container.entity?.ref)
  }
};

return scope;
