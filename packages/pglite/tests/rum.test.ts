import { describe, expect, it } from 'vitest'
import { testEsmCjsAndDTC } from './test-utils.ts'

await testEsmCjsAndDTC(async (importType) => {
  const { PGlite } =
    importType === 'esm'
      ? await import('../dist/index.js')
      : ((await import(
          '../dist/index.cjs'
        )) as unknown as typeof import('../dist/index.js'))

  const { rum } =
    importType === 'esm'
      ? await import('../dist/rum/index.js')
      : ((await import(
          '../dist/rum/index.cjs'
        )) as unknown as typeof import('../dist/rum/index.js'))

  describe('rum', () => {
    it('can load extension', async () => {
      const pg = new PGlite({
        extensions: { rum },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

      const res = await pg.query<{ extname: string }>(`
        SELECT extname
        FROM pg_extension
        WHERE extname = 'rum'
      `)

      expect(res.rows).toHaveLength(1)
      expect(res.rows[0].extname).toBe('rum')
    })

    it('can build and query a rum full-text index', async () => {
      const pg = new PGlite({
        extensions: { rum },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')
      await pg.exec(`
        CREATE TABLE test_rum (
          id SERIAL PRIMARY KEY,
          t TEXT,
          a tsvector
        );

        INSERT INTO test_rum(t, a) VALUES
          ('The situation is most beautiful', to_tsvector('english', 'The situation is most beautiful')),
          ('It is a beautiful', to_tsvector('english', 'It is a beautiful')),
          ('It looks like a beautiful place', to_tsvector('english', 'It looks like a beautiful place'));

        CREATE INDEX rumidx ON test_rum USING rum (a rum_tsvector_ops);
      `)

      const matchBeautifulOrPlace = await pg.query<{ t: string }>(`
        SELECT t
        FROM test_rum
        WHERE a @@ to_tsquery('english', 'beautiful | place')
        ORDER BY id
      `)

      expect(matchBeautifulOrPlace.rows.map((r) => r.t)).toEqual([
        'The situation is most beautiful',
        'It is a beautiful',
        'It looks like a beautiful place',
      ])

      const indexMeta = await pg.query<{ amname: string }>(`
        SELECT am.amname
        FROM pg_class c
        JOIN pg_am am ON am.oid = c.relam
        WHERE c.relname = 'rumidx'
      `)

      expect(indexMeta.rows).toEqual([{ amname: 'rum' }])
    })

    it('supports proximity ordering with int4 addon data', async () => {
      const pg = new PGlite({
        extensions: { rum },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')
      await pg.exec(`
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

      const res = await pg.query<{ t: string; pos: number; distance: number }>(`
        SELECT t, pos, pos <=> 27::int4 AS distance
        FROM test_rum_proximity
        WHERE a @@ to_tsquery('english', 'beautiful')
        ORDER BY pos <=> 27::int4, id
        LIMIT 4
      `)

      expect(res.rows.map((r) => r.t)).toEqual([
        'beautiful gamma',
        'beautiful beta',
        'beautiful alpha',
        'beautiful delta',
      ])
      expect(res.rows.map((r) => r.distance)).toEqual([3, 7, 22, 33])
    })

    it('supports proximity ordering with timestamp addon data', async () => {
      const pg = new PGlite({
        extensions: { rum },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')
      await pg.exec(`
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

      const res = await pg.query<{ t: string }>(`
        SELECT t
        FROM test_rum_ts_proximity
        WHERE a @@ to_tsquery('english', 'beautiful')
        ORDER BY ts <=> '2016-05-16 14:21:25'::timestamp, id
        LIMIT 4
      `)

      expect(res.rows.map((r) => r.t)).toEqual([
        'beautiful target',
        'beautiful near',
        'beautiful early',
        'beautiful late',
      ])
    })
  })
})
