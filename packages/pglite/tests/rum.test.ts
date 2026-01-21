import { describe, it, expect } from 'vitest'
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

  describe(`rum`, () => {
    it('basic full-text search with RUM index', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

      // Create a table for full-text search
      await pg.exec(`
        CREATE TABLE documents (
          id SERIAL PRIMARY KEY,
          title TEXT,
          body TEXT,
          body_tsvector tsvector
        );
      `)

      // Insert some documents
      await pg.exec(`
        INSERT INTO documents (title, body, body_tsvector) VALUES
          ('PostgreSQL Tutorial', 'PostgreSQL is a powerful open source database', to_tsvector('english', 'PostgreSQL is a powerful open source database')),
          ('RUM Index Guide', 'RUM index provides fast full-text search with ranking', to_tsvector('english', 'RUM index provides fast full-text search with ranking')),
          ('Database Performance', 'Optimizing database queries for better performance', to_tsvector('english', 'Optimizing database queries for better performance'));
      `)

      // Create a RUM index on the tsvector column
      await pg.exec(`
        CREATE INDEX documents_rum_idx ON documents USING rum (body_tsvector rum_tsvector_ops);
      `)

      // Search using the RUM index
      const res = await pg.query<{ id: number; title: string }>(`
        SELECT id, title
        FROM documents
        WHERE body_tsvector @@ to_tsquery('english', 'database')
        ORDER BY id;
      `)

      expect(res.rows).toEqual([
        { id: 1, title: 'PostgreSQL Tutorial' },
        { id: 3, title: 'Database Performance' },
      ])
    })

    it('RUM index with ranking', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

      await pg.exec(`
        CREATE TABLE articles (
          id SERIAL PRIMARY KEY,
          content TEXT,
          content_tsvector tsvector
        );
      `)

      await pg.exec(`
        INSERT INTO articles (content, content_tsvector) VALUES
          ('The quick brown fox', to_tsvector('english', 'The quick brown fox')),
          ('Quick quick quick foxes', to_tsvector('english', 'Quick quick quick foxes')),
          ('Slow brown dog', to_tsvector('english', 'Slow brown dog'));
      `)

      await pg.exec(`
        CREATE INDEX articles_rum_idx ON articles USING rum (content_tsvector rum_tsvector_ops);
      `)

      // Use RUM's ranking capabilities
      const res = await pg.query<{ id: number; content: string }>(`
        SELECT id, content
        FROM articles
        WHERE content_tsvector @@ to_tsquery('english', 'quick')
        ORDER BY content_tsvector <=> to_tsquery('english', 'quick');
      `)

      expect(res.rows.length).toBe(2)
      // The document with more occurrences of 'quick' should be ranked higher (closer distance)
      expect(res.rows[0].id).toBe(2) // 'Quick quick quick foxes' has more matches
      expect(res.rows[1].id).toBe(1) // 'The quick brown fox' has fewer matches
    })

    it('btree_rum operations', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

      // btree_rum allows using RUM index for scalar types
      await pg.exec(`
        CREATE TABLE events (
          id SERIAL PRIMARY KEY,
          event_time TIMESTAMP,
          description TEXT
        );
      `)

      await pg.exec(`
        INSERT INTO events (event_time, description) VALUES
          ('2024-01-01 10:00:00', 'New Year Event'),
          ('2024-01-15 14:30:00', 'Mid-January Meeting'),
          ('2024-02-01 09:00:00', 'February Planning');
      `)

      // Create a RUM index on timestamp using btree_rum
      await pg.exec(`
        CREATE INDEX events_time_rum_idx ON events USING rum (event_time rum_timestamp_ops);
      `)

      const res = await pg.query<{ id: number; description: string }>(`
        SELECT id, description
        FROM events
        WHERE event_time > '2024-01-10'::timestamp
        ORDER BY event_time;
      `)

      expect(res.rows).toEqual([
        { id: 2, description: 'Mid-January Meeting' },
        { id: 3, description: 'February Planning' },
      ])
    })

    it('has correct extension loaded', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

      const res = await pg.query<{ extname: string; extversion: string }>(`
        SELECT extname, extversion
        FROM pg_extension
        WHERE extname = 'rum'
      `)

      expect(res.rows.length).toBe(1)
      expect(res.rows[0].extname).toBe('rum')
      expect(res.rows[0].extversion).toBe('1.4')
    })

    it('rum_anyarray_addon_ops with timestamp ordering via |=>', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

      // Create a table with array columns and a timestamp for ordering
      await pg.exec(`
        CREATE TABLE items (
          id SERIAL PRIMARY KEY,
          received TIMESTAMPTZ NOT NULL,
          groups TEXT[] NOT NULL DEFAULT '{}'
        );
      `)

      // Create RUM index with rum_anyarray_addon_ops and attached timestamp
      await pg.exec(`
        CREATE INDEX idx_items_groups_rum ON items
        USING rum (groups rum_anyarray_addon_ops, received)
        WITH (attach = 'received', to = 'groups');
      `)

      // Insert test data
      await pg.exec(`
        INSERT INTO items (id, received, groups) VALUES
          (1, '2024-01-15 10:00:00+00', ARRAY['alpha', 'beta']),
          (2, '2024-06-01 12:00:00+00', ARRAY['alpha', 'gamma']),
          (3, '2024-03-20 08:00:00+00', ARRAY['beta', 'delta']),
          (4, '2024-05-10 14:00:00+00', ARRAY['alpha', 'beta', 'gamma']),
          (5, '2024-02-28 16:00:00+00', ARRAY['gamma', 'delta']);
      `)

      // Query using subset operator and |=> distance ordering
      const res = await pg.query<{ id: number; received: Date; groups: string[] }>(`
        SELECT id, received, groups
        FROM items
        WHERE groups <@ ARRAY['alpha', 'beta', 'gamma', 'delta']::text[]
          AND groups @> ARRAY['alpha']::text[]
        ORDER BY received |=> '2024-06-01 00:00:00+00'::timestamptz
        LIMIT 10;
      `)

      // Results should be ordered by distance from 2024-06-01
      expect(res.rows.length).toBe(3)
      // id=2 (2024-06-01) is closest to target date
      expect(res.rows[0].id).toBe(2)
      // id=4 (2024-05-10) is next closest
      expect(res.rows[1].id).toBe(4)
      // id=1 (2024-01-15) is furthest
      expect(res.rows[2].id).toBe(1)
    })

    it('multiple RUM indexes combined with BitmapAnd', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

      // Create a table with multiple array columns
      await pg.exec(`
        CREATE TABLE tagged_items (
          id SERIAL PRIMARY KEY,
          received TIMESTAMPTZ NOT NULL,
          groups TEXT[] NOT NULL DEFAULT '{}',
          tags TEXT[] NOT NULL DEFAULT '{}'
        );
      `)

      // Create separate RUM indexes for each array column with attached timestamp
      await pg.exec(`
        CREATE INDEX idx_tagged_groups_rum ON tagged_items
        USING rum (groups rum_anyarray_addon_ops, received)
        WITH (attach = 'received', to = 'groups');
      `)

      await pg.exec(`
        CREATE INDEX idx_tagged_tags_rum ON tagged_items
        USING rum (tags rum_anyarray_addon_ops, received)
        WITH (attach = 'received', to = 'tags');
      `)

      // Insert test data
      await pg.exec(`
        INSERT INTO tagged_items (id, received, groups, tags) VALUES
          (1, '2024-01-15 10:00:00+00', ARRAY['alpha', 'beta'], ARRAY['urgent', 'review']),
          (2, '2024-06-01 12:00:00+00', ARRAY['alpha', 'gamma'], ARRAY['urgent', 'approved']),
          (3, '2024-03-20 08:00:00+00', ARRAY['beta', 'delta'], ARRAY['review', 'pending']),
          (4, '2024-05-10 14:00:00+00', ARRAY['alpha', 'beta', 'gamma'], ARRAY['urgent', 'review', 'approved']),
          (5, '2024-02-28 16:00:00+00', ARRAY['gamma', 'delta'], ARRAY['pending']);
      `)

      // Query combining conditions on both array columns
      // This should use BitmapAnd to combine results from both RUM indexes
      const res = await pg.query<{ id: number; received: Date }>(`
        SELECT id, received
        FROM tagged_items
        WHERE groups @> ARRAY['alpha']::text[]
          AND tags @> ARRAY['urgent']::text[]
        ORDER BY received |=> '2024-06-01 00:00:00+00'::timestamptz
        LIMIT 10;
      `)

      // Only items with 'alpha' in groups AND 'urgent' in tags
      expect(res.rows.length).toBe(3)
      // Ordered by distance from 2024-06-01
      expect(res.rows[0].id).toBe(2) // 2024-06-01, closest
      expect(res.rows[1].id).toBe(4) // 2024-05-10
      expect(res.rows[2].id).toBe(1) // 2024-01-15, furthest
    })

    it('rum_anyarray_ops without addon for simple array containment', async () => {
      const pg = new PGlite({
        extensions: {
          rum,
        },
      })

      await pg.exec('CREATE EXTENSION IF NOT EXISTS rum;')

      await pg.exec(`
        CREATE TABLE simple_arrays (
          id SERIAL PRIMARY KEY,
          values INTEGER[]
        );
      `)

      await pg.exec(`
        CREATE INDEX idx_simple_values_rum ON simple_arrays
        USING rum (values rum_anyarray_ops);
      `)

      await pg.exec(`
        INSERT INTO simple_arrays (id, values) VALUES
          (1, ARRAY[1, 2, 3]),
          (2, ARRAY[2, 3, 4]),
          (3, ARRAY[3, 4, 5]),
          (4, ARRAY[1, 3, 5]);
      `)

      // Test superset operator @>
      const superset = await pg.query<{ id: number }>(`
        SELECT id FROM simple_arrays
        WHERE values @> ARRAY[2, 3]::integer[]
        ORDER BY id;
      `)
      expect(superset.rows).toEqual([{ id: 1 }, { id: 2 }])

      // Test subset operator <@
      const subset = await pg.query<{ id: number }>(`
        SELECT id FROM simple_arrays
        WHERE values <@ ARRAY[1, 2, 3, 4, 5]::integer[]
        ORDER BY id;
      `)
      expect(subset.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }])

      // Test overlap operator &&
      const overlap = await pg.query<{ id: number }>(`
        SELECT id FROM simple_arrays
        WHERE values && ARRAY[5, 6]::integer[]
        ORDER BY id;
      `)
      expect(overlap.rows).toEqual([{ id: 3 }, { id: 4 }])
    })
  })
})
