// Import mapping: the inverse of lists.spec.js. Builds the lists from `data.lists`: as lists.spec.js writes them, or as the
// transformation of the platform leaves them ({ id, entity, properties: [{ property }] }).
/** @type {Import} */
const importer = function (json, { n }) {
  // a label that is only the name is not written
  const label = (item, name) => (item.label !== name ? item.label : undefined);
  const identifier = text => String(text).replace(/[^\wÀ-ɏ-]+/g, '').replace(/^([^_a-zA-ZÀ-ɏ])/, '_$1');

  const column = c => n('ListColumn', { property: c.name, label: label(c, c.name) });

  const fromPlatform = l => {
    const name = identifier(l.id ?? `${l.entity}List`);
    return n('ListDef', {
      name,
      label: l.id !== undefined && l.id !== name ? l.id : undefined,
      entity: l.entity,
      columns: l.properties.map(p => n('ListColumn', { property: p.property }))
    });
  };

  const list = l => (l.name === undefined && Array.isArray(l.properties)
    ? fromPlatform(l)
    : n('ListDef', {
      name: l.name,
      label: label(l, l.name),
      entity: l.entity,
      pageSize: l.pageSize,
      sortBy: l.sortBy,
      descending: l.sortBy !== undefined ? l.descending : undefined,
      columns: l.columns?.map(column)
    }));

  return n('ListModel', { lists: (json.data.lists ?? []).map(list) });
};

return importer;
