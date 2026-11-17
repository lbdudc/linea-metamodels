// Import mapping: the inverse of forms.spec.js. Builds the forms from `data.forms`: as forms.spec.js writes them, or as the
// transformation of the platform leaves them ({ id, entity, properties: [{ property, viewing, editing }] }).
/** @type {Import} */
const importer = function (json, { n }) {
  // a label that is only the name is not written
  const label = (item, name) => (item.label !== name ? item.label : undefined);
  const identifier = text => String(text).replace(/[^\wÀ-ɏ-]+/g, '').replace(/^([^_a-zA-ZÀ-ɏ])/, '_$1');

  const field = f => n('FormField', { property: f.name, label: label(f, f.name), readOnly: f.readOnly });

  const fromPlatform = f => {
    const name = identifier(f.id ?? `${f.entity}Form`);
    return n('FormDef', {
      name,
      label: f.id !== undefined && f.id !== name ? f.id : undefined,
      entity: f.entity,
      fields: f.properties.filter(p => p.viewing !== false).map(p => n('FormField', { property: p.property, readOnly: p.editing === false || undefined }))
    });
  };

  const form = f => (f.name === undefined && Array.isArray(f.properties)
    ? fromPlatform(f)
    : n('FormDef', { name: f.name, label: label(f, f.name), entity: f.entity, fields: f.fields?.map(field) }));

  return n('FormModel', { forms: (json.data.forms ?? []).map(form) });
};

return importer;
