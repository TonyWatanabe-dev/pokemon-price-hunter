// db-validate: migrations do repositório x versões registradas (função pura, sem banco).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { migrationChecks } from '../tools/db-validate.mjs';

const byName = (files, versions) => Object.fromEntries(migrationChecks(files, versions).map((c) => [c.name, c]));
const ALL = 'toda migration do repositório registrada', NONE = 'nenhuma versão registrada sem arquivo';

// lista igual (ordem não importa): os dois ok
{
  const r = byName(['001_core.sql', '002_seed.sql'], ['002_seed.sql', '001_core.sql']);
  assert.equal(r[ALL].ok, true); assert.equal(r[NONE].ok, true);
  assert.equal(r[ALL].detail, '2 migrations'); assert.equal(r[NONE].detail, '2 versões');
}

// arquivo sem registro: só o primeiro falha, com o nome no detail
{
  const r = byName(['001_core.sql', '002_seed.sql', '003_x.sql'], ['001_core.sql', '002_seed.sql']);
  assert.equal(r[ALL].ok, false); assert.match(r[ALL].detail, /003_x\.sql/);
  assert.equal(r[NONE].ok, true);
}

// versão registrada sem arquivo: só o segundo falha, com o nome no detail
{
  const r = byName(['001_core.sql'], ['001_core.sql', '009_removida.sql']);
  assert.equal(r[ALL].ok, true);
  assert.equal(r[NONE].ok, false); assert.match(r[NONE].detail, /009_removida\.sql/);
}

// falta e sobra ao mesmo tempo, vários nomes ordenados
{
  const r = byName(['001_a.sql', '003_c.sql', '002_b.sql'], ['001_a.sql', '005_e.sql', '004_d.sql']);
  assert.equal(r[ALL].ok, false); assert.equal(r[ALL].detail, 'sem registro: 002_b.sql, 003_c.sql');
  assert.equal(r[NONE].ok, false); assert.equal(r[NONE].detail, 'sem arquivo: 004_d.sql, 005_e.sql');
}

// banco vazio: tudo falta, nada sobra
{
  const r = byName(['001_core.sql'], []);
  assert.equal(r[ALL].ok, false); assert.equal(r[NONE].ok, true);
}

// as migrations reais do repositório batem com elas mesmas (nomes como o db-migrate registra)
{
  const files = fs.readdirSync(new URL('../db/migrations/', import.meta.url)).filter((f) => f.endsWith('.sql'));
  assert.ok(files.length > 0);
  assert.ok(migrationChecks(files, files).every((c) => c.ok));
}

console.log('db-validate migrations: ok');
