const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

test("sync migration enforces account isolation, CAS conflicts and deletion tombstones in Postgres", async () => {
  const db = new PGlite();
  const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;");
    await db.query("insert into auth.users values ($1), ($2)", [a, b]);
    const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/202610230001_reader_sync.sql"), "utf8");
    await db.exec(migration); await db.exec(migration);
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from public.reader_sync_records"), /permission denied/);
    await assert.rejects(db.query("select * from public.reader_sync_apply('[]'::jsonb)"), /permission denied/);
    await db.exec("reset role; set role authenticated");
    const user = (id) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    const write = async (value, revision = 0) => (await db.query("select * from public.reader_sync_apply($1::jsonb)", [JSON.stringify([{ key: "favorite/book", value, expected_revision: revision }])])).rows[0];
    await user(a);
    assert.deepEqual(await write(true), { record_key: "favorite/book", value: true, revision: 1, applied: true });
    assert.deepEqual(await write(false), { record_key: "favorite/book", value: true, revision: 1, applied: false });
    await user(b);
    assert.equal((await db.query("select * from public.reader_sync_records")).rows.length, 0);
    assert.equal((await db.query("update public.reader_sync_records set value = 'false' where user_id = $1 returning *", [a])).rows.length, 0);
    await assert.rejects(db.query("insert into public.reader_sync_records(user_id, record_key, value) values($1, 'favorite/stolen', 'true')", [a]), /row-level security/);
    assert.equal((await write(false)).applied, true);
    await user(a);
    await assert.rejects(db.query("update public.reader_sync_records set user_id = $1", [b]), /row-level security/);
    assert.deepEqual(await write(null, 1), { record_key: "favorite/book", value: null, revision: 2, applied: true });
    assert.deepEqual(await write(true, 1), { record_key: "favorite/book", value: null, revision: 2, applied: false });
    assert.equal((await write(true, 2)).revision, 3);
    await assert.rejects(db.query("delete from public.reader_sync_records"), /permission denied/);
  } finally { await db.close(); }
});
