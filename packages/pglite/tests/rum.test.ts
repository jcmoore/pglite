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
  })
})
