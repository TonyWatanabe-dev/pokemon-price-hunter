// Importação rastreável de referências de preço (Fase 5.6). Idempotente: rodar de novo não escreve nada.
// Regras: valida cada entrada (tipo, domínio Copag, datas parciais, evidência); recusa produto inexistente, produto excluído
// (match ambíguo) e identificador que já pertence a outro produto. Nunca apaga, nunca eleva confiança, nunca converte histórico em atual.
import { validateImportEntry } from './references.js';

const J = (v) => JSON.stringify(v);
const COLS = { reference_kind: 'text', currency: 'text', source_url: 'text', page_title: 'text', published_at: 'text', effective_date: 'text',
  observed_at: 'timestamptz', verification_status: 'text', verified_at: 'timestamptz', confidence: 'smallint', evidence_text: 'text', notes: 'text' };

export function planImport(file, products) {
  const pid = new Map(products.map((p) => [p.legacy_id, String(p.id)]));
  const excluded = file.excluded || [];
  const ok = []; const rejected = [];
  for (const e of file.entries || []) {
    const bad = validateImportEntry(e, { excluded });
    if (!bad.length && !pid.has(e.legacy_id)) bad.push('produto não existe no catálogo');
    if (bad.length) rejected.push({ legacy_id: e?.legacy_id ?? null, reasons: bad });
    else ok.push({ ...e, product_id: pid.get(e.legacy_id), currency: e.currency || 'BRL', notes: [e.notes, `importação ${file.import_id}`].filter(Boolean).join(' · ') });
  }
  return { ok, rejected };
}

export async function importReferences(c, file) {
  const products = (await c.query('SELECT id, legacy_id FROM product WHERE legacy_id IS NOT NULL')).rows;
  const { ok, rejected } = planImport(file, products);
  const cols = Object.keys(COLS);
  const up = ok.length ? await c.query(`INSERT INTO reference_price (product_id, value, source, ${cols.join(', ')})
    SELECT product_id, value, source, ${cols.join(', ')} FROM jsonb_to_recordset($1::jsonb)
      AS x(product_id bigint, value numeric, source text, ${cols.map((k) => `${k} ${COLS[k]}`).join(', ')})
    ON CONFLICT (product_id, source, value) DO UPDATE SET ${cols.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}
    WHERE (${cols.map((k) => `reference_price.${k}`).join(', ')}) IS DISTINCT FROM (${cols.map((k) => `EXCLUDED.${k}`).join(', ')})
    RETURNING (xmax = 0) AS inserted`, [J(ok)]) : { rows: [] };
  const inserted = up.rows.filter((r) => r.inserted).length; const updated = up.rows.length - inserted;

  // identificadores (código Copag = mpn): recusa se o valor já pertence a OUTRO produto
  const ids = ok.flatMap((e) => (e.identifiers || []).map((i) => ({ product_id: e.product_id, legacy_id: e.legacy_id, kind: i.kind, value: String(i.value), source: i.source || 'copag', confidence: i.confidence ?? 100 })));
  const idConflicts = [];
  let idsWritten = 0;
  if (ids.length) {
    const taken = (await c.query(`SELECT i.kind, i.value, i.product_id::text, p.legacy_id FROM product_identifier i JOIN product p ON p.id = i.product_id
      WHERE (i.kind, i.value) IN (SELECT kind, value FROM jsonb_to_recordset($1::jsonb) AS x(kind text, value text))`, [J(ids)])).rows;
    const free = ids.filter((i) => { const t = taken.find((x) => x.kind === i.kind && x.value === i.value && x.product_id !== String(i.product_id));
      if (t) idConflicts.push({ legacy_id: i.legacy_id, kind: i.kind, value: i.value, already: t.legacy_id }); return !t; });
    if (free.length) idsWritten = (await c.query(`INSERT INTO product_identifier (product_id, kind, value, source, confidence)
      SELECT product_id, kind, value, source, confidence FROM jsonb_to_recordset($1::jsonb) AS x(product_id bigint, kind text, value text, source text, confidence smallint)
      ON CONFLICT (kind, value, source) DO NOTHING`, [J(free)])).rowCount;
  }
  const res = { import_id: file.import_id, entries: (file.entries || []).length, valid: ok.length, inserted, updated, unchanged: ok.length - inserted - updated,
    rejected, excluded: file.excluded || [], identifiers: { written: idsWritten, conflicts: idConflicts } };
  if (inserted || updated || idsWritten) await c.query(`INSERT INTO system_event (type, entity_type, entity_id, payload) VALUES ('REFERENCES_IMPORTED', 'import', $1, $2::jsonb)`,
    [file.import_id, J({ inserted, updated, identifiers: idsWritten, rejected: rejected.length })]);
  return res;
}
