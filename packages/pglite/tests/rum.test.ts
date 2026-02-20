import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
        extensions: {
          rum,
        },
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

    it('can create and query a RUM full-text index', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec(`
        CREATE EXTENSION IF NOT EXISTS rum;
        CREATE TABLE docs (
          id SERIAL PRIMARY KEY,
          content TEXT NOT NULL,
          tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
        );

        INSERT INTO docs (content) VALUES
          ('the quick brown fox jumps over the lazy dog'),
          ('quick red fox and quick blue hare'),
          ('slow turtle in the garden');

        CREATE INDEX docs_tsv_rum_idx ON docs USING rum (tsv rum_tsvector_ops);
      `)

      const res = await pg.query<{ id: number }>(`
        SELECT id
        FROM docs
        WHERE tsv @@ plainto_tsquery('english', 'quick fox')
        ORDER BY id
      `)

      expect(res.rows).toEqual([{ id: 1 }, { id: 2 }])

      await pg.exec('SET enable_seqscan = off;')
      const plan = await pg.query<{ "QUERY PLAN": string }>(`
        EXPLAIN SELECT id
        FROM docs
        WHERE tsv @@ plainto_tsquery('english', 'quick fox')
      `)

      expect(
        plan.rows.some((row) => row['QUERY PLAN'].includes('docs_tsv_rum_idx')),
      ).toBe(true)
    })

    it('supports rum_anyarray_addon_ops index with an attached timestamp column', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec(`
        CREATE EXTENSION IF NOT EXISTS rum;

        CREATE TABLE tagged_events (
          id SERIAL PRIMARY KEY,
          tags int2[] NOT NULL,
          event_time timestamp NOT NULL
        );

        INSERT INTO tagged_events (tags, event_time) VALUES
          ('{1,2}', '2024-01-01 10:00:00'),
          ('{1,3}', '2024-01-01 10:10:00'),
          ('{2,3}', '2024-01-01 09:55:00'),
          ('{1,4}', '2024-01-01 10:30:00');

        CREATE INDEX tagged_events_tags_rum_idx ON tagged_events
          USING rum (tags rum_anyarray_addon_ops, event_time)
          WITH (attach = 'event_time', to = 'tags');
      `)

      const res = await pg.query<{ id: number }>(`
        SELECT id
        FROM tagged_events
        WHERE tags && '{1}'::int2[]
          AND event_time <= '2024-01-01 10:10:00'::timestamp
        ORDER BY id
      `)

      expect(res.rows).toEqual([{ id: 1 }, { id: 2 }])

      await pg.exec('SET enable_seqscan = off;')
      const plan = await pg.query<{ "QUERY PLAN": string }>(`
        EXPLAIN
        SELECT id
        FROM tagged_events
        WHERE tags && '{1}'::int2[]
          AND event_time <= '2024-01-01 10:10:00'::timestamp
      `)

      expect(
        plan.rows.some((row) =>
          row['QUERY PLAN'].includes('tagged_events_tags_rum_idx'),
        ),
      ).toBe(true)
    })

    it('supports anyarray addon ORDER BY proximity over pass-by-value attached types', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec(`
        CREATE EXTENSION IF NOT EXISTS rum;

        CREATE TABLE tagged_scores (
          id SERIAL PRIMARY KEY,
          tags int2[] NOT NULL,
          score int4 NOT NULL
        );

        INSERT INTO tagged_scores (tags, score) VALUES
          ('{1,2}', 10),
          ('{1,3}', 20),
          ('{1,4}', 30),
          ('{2,4}', 40);

        CREATE INDEX tagged_scores_tags_rum_idx ON tagged_scores
          USING rum (tags rum_anyarray_addon_ops, score)
          WITH (attach = 'score', to = 'tags');
      `)

      const res = await pg.query<{ id: number }>(`
        SELECT id
        FROM tagged_scores
        WHERE tags && '{1}'::int2[]
        ORDER BY score |=> 15
        LIMIT 3
      `)

      expect(res.rows).toEqual([{ id: 2 }, { id: 3 }, { id: 1 }])

      await pg.exec('SET enable_seqscan = off;')
      const plan = await pg.query<{ "QUERY PLAN": string }>(`
        EXPLAIN
        SELECT id
        FROM tagged_scores
        WHERE tags && '{1}'::int2[]
        ORDER BY score |=> 15
        LIMIT 3
      `)

      expect(
        plan.rows.some((row) =>
          row['QUERY PLAN'].includes('tagged_scores_tags_rum_idx'),
        ),
      ).toBe(true)
    })

    it('supports anyarray addon ORDER BY proximity over fixed-length pass-by-reference timestamp', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec(`
        CREATE EXTENSION IF NOT EXISTS rum;

        CREATE TABLE tagged_events (
          id SERIAL PRIMARY KEY,
          tags int2[] NOT NULL,
          event_time timestamp NOT NULL
        );

        INSERT INTO tagged_events (tags, event_time) VALUES
          ('{1,2}', '2024-01-01 10:00:00'),
          ('{1,3}', '2024-01-01 10:09:00');

        CREATE INDEX tagged_events_tags_rum_idx ON tagged_events
          USING rum (tags rum_anyarray_addon_ops, event_time)
          WITH (attach = 'event_time', to = 'tags');
      `)

      const res = await pg.query<{ id: number }>(`
        SELECT id
        FROM tagged_events
        WHERE tags && '{1}'::int2[]
        ORDER BY event_time |=> '2024-01-01 10:05:00'::timestamp
        LIMIT 1
      `)

      expect(res.rows).toEqual([{ id: 1 }])
    })

    it('keeps timestamp addon ORDER BY behavior across restart', async () => {
      const dataDir = mkdtempSync(join(tmpdir(), 'pglite-rum-'))

      try {
        let pg = new PGlite({
          dataDir,
          extensions: {
            rum,
          },
        })

        await pg.exec(`
          CREATE EXTENSION IF NOT EXISTS rum;

          CREATE TABLE tagged_events (
            id SERIAL PRIMARY KEY,
            tags int2[] NOT NULL,
            event_time timestamp NOT NULL
          );

          INSERT INTO tagged_events (tags, event_time) VALUES
            ('{1,2}', '2024-01-01 10:00:00'),
            ('{1,3}', '2024-01-01 10:09:00');

          CREATE INDEX tagged_events_tags_rum_idx ON tagged_events
            USING rum (tags rum_anyarray_addon_ops, event_time)
            WITH (attach = 'event_time', to = 'tags');
        `)

        const beforeRestart = await pg.query<{ id: number }>(`
          SELECT id
          FROM tagged_events
          WHERE tags && '{1}'::int2[]
          ORDER BY event_time |=> '2024-01-01 10:05:00'::timestamp
          LIMIT 1
        `)

        expect(beforeRestart.rows).toEqual([{ id: 1 }])

        await pg.close()

        pg = new PGlite({
          dataDir,
          extensions: {
            rum,
          },
        })

        const afterRestart = await pg.query<{ id: number }>(`
          SELECT id
          FROM tagged_events
          WHERE tags && '{1}'::int2[]
          ORDER BY event_time |=> '2024-01-01 10:05:00'::timestamp
          LIMIT 1
        `)

        expect(afterRestart.rows).toEqual([{ id: 1 }])
      } finally {
        rmSync(dataDir, { recursive: true, force: true })
      }
    })
  })
})
