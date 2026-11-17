# LINEA metamodels

The metamodels the product lines of [LINEA](https://github.com/lbdudc/linea) are made of: the data model, the interface, the security, the maps... Each one is a folder with a `metamodel.json`, its grammars, specs and templates.

| Metamodel | What it describes |
|---|---|
| [`basic`](metamodels/basic) | Basic: the product's name, version, SRID, languages, package, database and deployment settings |
| [`browser`](metamodels/browser) | Lists and forms: the tables and the data-entry forms of the product, one of each over each data-model entity, with what a person can do with them and the fields they show. Needs the data model |
| [`common`](metamodels/common) | Shared terminals and data types (a library: it has no entry rule) |
| [`datamodel`](metamodels/datamodel) | Data model: entities made of property fields and relationship fields, enumerations and inheritance |
| [`featuremodel`](metamodels/featuremodel) | Feature model of an SPL (features, groups, constraints) and the feature selection of its products. Its models are level 1 (the SPL's) and level 0 (the products') |
| [`forms`](metamodels/forms) | Forms: data-entry forms over data-model entities. Optional in a product; needs the data model |
| [`gismodel`](metamodels/gismodel) | GIS model: maps, layers and styles. A GeoJSON layer must show a data-model entity |
| [`gui`](metamodels/gui) | Interface: where the menus of the product are (the design), its font and its colours |
| [`lists`](metamodels/lists) | Lists: tables of data-model entities, with the columns to show and how to sort them. Optional in a product; needs the data model |
| [`menus`](metamodels/menus) | Menus: the navigation of the product, as the platform lays it out: menus of items that open a screen of the platform or group more items |
| [`security`](metamodels/security) | Security: users, roles and what each role may do with entities, forms and lists. Needs the data model, the forms and the lists |
| [`sensors`](metamodels/sensors) | Sensors: the sensors of the product, with their measurements and dimensions. Needs the data model and the GIS model |
| [`statics`](metamodels/statics) | Static pages: pages of HTML the product shows (a home page, an about page), each with a name |

## Use them

The official LINEA image (`ghcr.io/lbdudc/linea-server`) carries these metamodels: with the `local` git host LINEA publishes them into its own registry when it starts (`REGISTRY_DIR=/srv/registry`, `LINEA_REGISTRY=local:registry/index`). To use another copy, point `REGISTRY_DIR` at a folder that has `metamodels/<name>/` in it, as this repository does.

On GitLab or GitHub, publish them once with `scripts/publish-registry.mjs` of LINEA.

## Contribute

A metamodel is a folder in `metamodels/`. Keep its `metamodel.json` version in step with what you change (they are versioned, and lines pin a range). The LINEA tests build products from `featuremodel` and `common`, so a change to them runs in LINEA's CI.

Licensed under Apache-2.0.
