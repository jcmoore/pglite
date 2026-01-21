const { PGlite } = await import('../../packages/pglite/dist/index.js');
const { rum } = await import('../../packages/pglite/dist/rum/index.js');
console.log('Test Multiple RUM Indexes Combined with BitmapAnd');
const pg = new PGlite({ extensions: { rum } });
await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;');

// Create table
await pg.exec(`
  CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    received TIMESTAMPTZ NOT NULL,
    groups TEXT[] NOT NULL,
    tags TEXT[] NOT NULL,
    meta JSONB NOT NULL
  );
`);

// Create RUM indexes
await pg.exec(`
  CREATE INDEX idx_items_groups_rum ON items
    USING RUM (groups rum_anyarray_addon_ops, received)
    WITH (attach = 'received', to = 'groups');
`);

await pg.exec(`
  CREATE INDEX idx_items_tags_rum ON items
    USING RUM (tags rum_anyarray_addon_ops, received)
    WITH (attach = 'received', to = 'tags');
`);

// Create GIN index on meta
await pg.exec(`
  CREATE INDEX idx_items_meta ON items USING GIN (meta jsonb_path_ops);
`);

console.log('All indexes created!');

// Insert more test data
await pg.exec(`
  INSERT INTO items (received, groups, tags, meta) VALUES
    ('2024-01-15 10:00:00+00', '{alpha,beta}', '{news,tech,i}', '{"9": {}}'),
    ('2024-06-01 12:00:00+00', '{alpha,gamma}', '{sports,news,i}', '{"9": {}}'),
    ('2024-03-20 08:00:00+00', '{beta,delta}', '{tech,science}', '{"8": {}}'),
    ('2024-05-10 14:00:00+00', '{alpha,beta,gamma}', '{news,i}', '{"9": {}}'),
    ('2024-07-25 16:00:00+00', '{delta}', '{sports,tech,i}', '{"8": {}, "9": {}}'),
    ('2024-02-28 09:00:00+00', '{alpha}', '{news,tech,i}', '{"9": {}}'),
    ('2024-04-15 11:00:00+00', '{alpha,beta}', '{sports,i}', '{"8": {}}');
`);
console.log('Data inserted!');

// Test BitmapAnd: groups AND tags
console.log('\\nEXPLAIN for BitmapAnd query (groups + tags):');
const explain1 = await pg.query(`
  EXPLAIN SELECT id, received, groups, tags
  FROM items
  WHERE groups <@ '{alpha,beta,gamma,delta}'::text[]
    AND groups @> '{alpha}'::text[]
    AND tags @> '{i}'::text[]
  ORDER BY received |=> '2024-06-01'::timestamptz
  LIMIT 10;
`);
console.log(explain1.rows.map(r => r['QUERY PLAN']).join('\\n'));

// Run the query
console.log('\\nQuery results (BitmapAnd: groups + tags):');
const res1 = await pg.query(`
  SELECT id, received, groups, tags
  FROM items
  WHERE groups <@ '{alpha,beta,gamma,delta}'::text[]
    AND groups @> '{alpha}'::text[]
    AND tags @> '{i}'::text[]
  ORDER BY received |=> '2024-06-01'::timestamptz
  LIMIT 10;
`);
console.log(JSON.stringify(res1.rows, null, 2));

// Test with meta filter too
console.log('\\nEXPLAIN for query with meta filter:');
const explain2 = await pg.query(`
  EXPLAIN SELECT id, received, groups, tags, meta
  FROM items
  WHERE groups <@ '{alpha,beta,gamma,delta}'::text[]
    AND groups @> '{alpha}'::text[]
    AND tags @> '{i}'::text[]
    AND meta @> '{\"9\": {}}'::jsonb
  ORDER BY received |=> '2024-06-01'::timestamptz
  LIMIT 10;
`);
console.log(explain2.rows.map(r => r['QUERY PLAN']).join('\\n'));

// Run with meta
console.log('\\nQuery results (with meta filter):');
const res2 = await pg.query(`
  SELECT id, received, groups, tags, meta
  FROM items
  WHERE groups <@ '{alpha,beta,gamma,delta}'::text[]
    AND groups @> '{alpha}'::text[]
    AND tags @> '{i}'::text[]
    AND meta @> '{"9": {}}'::jsonb
  ORDER BY received |=> '2024-06-01'::timestamptz
  LIMIT 10;
`);
console.log(JSON.stringify(res2.rows, null, 2));

await pg.close();
console.log('\\nAll tests completed successfully!');
