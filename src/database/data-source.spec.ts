import { globSync } from 'glob';
import dataDataSource, { postgresDataSourceOptions, buildPostgresDataSourceOptions } from './data-source';

// The data CLI DataSource manages the DATA connection's migrations (session/webhook/message/
// template/engine). It must NOT pull in the auth/audit entities — those belong to the always-SQLite
// MAIN connection (data-source-main.ts). A broad '**' entity glob would sweep the main-owned
// entities into `migration:generate` against the data DB and emit spurious auth/audit DDL.
describe('data CLI DataSource', () => {
  const resolveEntityFiles = (): string[] =>
    (dataDataSource.options.entities as string[])
      .flatMap(pattern => globSync(pattern))
      .map(file => file.replace(/\\/g, '/'));

  it('resolves the data-owned entities (session, webhook, message, template, engine)', () => {
    const files = resolveEntityFiles();
    expect(files.some(f => f.endsWith('session.entity.ts'))).toBe(true);
    expect(files.some(f => f.endsWith('webhook.entity.ts'))).toBe(true);
    expect(files.some(f => f.endsWith('message.entity.ts'))).toBe(true);
    expect(files.some(f => f.endsWith('template.entity.ts'))).toBe(true);
    expect(files.some(f => f.endsWith('lid-mapping.entity.ts'))).toBe(true);
  });

  it('never resolves the main-owned api-key/audit-log entities', () => {
    const files = resolveEntityFiles();
    expect(files.some(f => f.endsWith('api-key.entity.ts'))).toBe(false);
    expect(files.some(f => f.endsWith('audit-log.entity.ts'))).toBe(false);
  });

  it('does not use a catch-all entity glob (guards against re-broadening)', () => {
    for (const pattern of dataDataSource.options.entities as string[]) {
      expect(pattern).not.toMatch(/\/\.\.\/\*\*\/\*\.entity/);
    }
  });
});

// The migration CLI connection runs DDL (CREATE INDEX, unique backfills) that can legitimately take
// minutes on a large table. It must carry pool/connection timeouts for resilience but MUST NOT carry a
// server-side statement_timeout, or a long migration would be aborted mid-flight.
describe('Postgres migration connection pool timeouts', () => {
  const extra = postgresDataSourceOptions.extra as Record<string, number | undefined>;

  it('sets idle and connection pool timeouts', () => {
    expect(extra.idleTimeoutMillis).toBe(30000);
    expect(extra.connectionTimeoutMillis).toBe(10000);
  });

  it('never sets statement_timeout (would abort long-running migrations)', () => {
    expect(extra.statement_timeout).toBeUndefined();
  });
});

// POSTGRES_SCHEMA: a non-public schema sets TypeORM's `schema` option AND the session search_path (via
// pg's startup `options` param) so the project's raw, unqualified migration DDL + the typeorm_migrations
// ledger resolve to the configured schema. The default (public) path stays byte-identical to the
// pre-schema-selection behavior — no `options` key is added. The builder is tested directly so no
// process.env mutation or module reload is needed.
describe('PostgreSQL schema selection (POSTGRES_SCHEMA)', () => {
  // The builder returns the broad DataSourceOptions union; narrow to the postgres-specific fields
  // under test (both are optional on the union — schema only on postgres, extra on every member).
  type PgOpts = { schema?: string; extra?: Record<string, unknown> };

  it('defaults schema to "public" and does NOT set a search_path when POSTGRES_SCHEMA is unset', () => {
    const opts = buildPostgresDataSourceOptions({}) as PgOpts;
    expect(opts.schema).toBe('public');
    expect(opts.extra?.options).toBeUndefined();
  });

  it('passes schema through and sets extra.options search_path for a non-public schema', () => {
    const opts = buildPostgresDataSourceOptions({ POSTGRES_SCHEMA: 'openwa' }) as PgOpts;
    expect(opts.schema).toBe('openwa');
    expect(opts.extra?.options).toBe('-c search_path=openwa,public');
  });

  it('keeps the pool timeouts under a custom schema (only adds options; never drops them or adds statement_timeout)', () => {
    const opts = buildPostgresDataSourceOptions({ POSTGRES_SCHEMA: 'openwa' }) as PgOpts;
    expect(opts.extra?.max).toBe(10);
    expect(opts.extra?.idleTimeoutMillis).toBe(30000);
    expect(opts.extra?.connectionTimeoutMillis).toBe(10000);
    // the migration connection must STILL never carry a statement_timeout
    expect(opts.extra?.statement_timeout).toBeUndefined();
  });
});
