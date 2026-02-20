import { PGlite } from '../dist/index.js'
import { rum } from '../dist/rum/index.js'

const pg = new PGlite({
  extensions: { rum },
})

const run = async (name, fn) => {
  try {
    await fn()
    console.log(`PASS: ${name}`)
  } catch (err) {
    console.error(`FAIL: ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

await run('int4 proximity ordering', async () => {
  await pg.exec(`
    DROP TABLE IF EXISTS test_rum_proximity;
    CREATE TABLE test_rum_proximity (
      id SERIAL PRIMARY KEY,
      t TEXT,
      a tsvector,
      pos int4
    );

    INSERT INTO test_rum_proximity (t, a, pos) VALUES
      ('beautiful alpha', to_tsvector('english', 'beautiful alpha'), 5),
      ('beautiful beta', to_tsvector('english', 'beautiful beta'), 20),
      ('beautiful gamma', to_tsvector('english', 'beautiful gamma'), 30),
      ('beautiful delta', to_tsvector('english', 'beautiful delta'), 60);

    CREATE INDEX rumidx_proximity ON test_rum_proximity
      USING rum (a rum_tsvector_addon_ops, pos rum_int4_ops)
      WITH (attach = 'pos', to = 'a');
  `)

  const res = await pg.query(`
    SELECT t, pos, pos <=> 27::int4 AS distance
    FROM test_rum_proximity
    WHERE a @@ to_tsquery('english', 'beautiful')
    ORDER BY pos <=> 27::int4, id
    LIMIT 4
  `)

  console.log('int4 rows:', res.rows)
})

await run('timestamp proximity ordering', async () => {
  await pg.exec(`
    DROP TABLE IF EXISTS test_rum_ts_proximity;
    CREATE TABLE test_rum_ts_proximity (
      id SERIAL PRIMARY KEY,
      t TEXT,
      a tsvector,
      ts timestamp
    );

    INSERT INTO test_rum_ts_proximity (t, a, ts) VALUES
      ('beautiful early', to_tsvector('english', 'beautiful early'), '2016-05-16 14:21:22'),
      ('beautiful near', to_tsvector('english', 'beautiful near'), '2016-05-16 14:21:24'),
      ('beautiful target', to_tsvector('english', 'beautiful target'), '2016-05-16 14:21:25'),
      ('beautiful late', to_tsvector('english', 'beautiful late'), '2016-05-16 14:21:40');

    CREATE INDEX rumidx_ts_proximity ON test_rum_ts_proximity
      USING rum (a rum_tsvector_addon_ops, ts rum_timestamp_ops)
      WITH (attach = 'ts', to = 'a');
  `)

  const res = await pg.query(`
    SELECT t
    FROM test_rum_ts_proximity
    WHERE a @@ to_tsquery('english', 'beautiful')
    ORDER BY ts <=> '2016-05-16 14:21:25'::timestamp, id
    LIMIT 4
  `)

  console.log('timestamp rows:', res.rows)
})
