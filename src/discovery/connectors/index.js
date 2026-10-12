// Registro de conectores de busca intercambiáveis. Contrato de cada conector:
//   { id, keyName, available(): boolean, reason, search(q, { count }) → [{ url, title, snippet }], cost: { unit: 'query', estimate } }
// Um conector sem chave continua registrado (available() = false, reason 'sem chave') e aparece no relatório da rodada
// como indisponível. Nunca devolve resultado inventado. Para adicionar um conector: criar connectors/<id>.js com
// `create(env)` seguindo o contrato e incluir na lista FACTORIES.
import * as brave from './brave.js';
import * as bing from './bing.js';
import * as serper from './serper.js';

const FACTORIES = [brave, bing, serper];

export function registry(env = process.env) {
  const all = FACTORIES.map((m) => m.create(env));
  return {
    all,
    byId: (id) => all.find((c) => c.id === id) || null,
    available: () => all.filter((c) => c.available()),
    // Primeiro disponível na ordem do registro (ou DISCOVERY_CONNECTOR, se definido e disponível).
    pick: (preferred = env.DISCOVERY_CONNECTOR) => (preferred && all.find((c) => c.id === preferred && c.available())) || all.find((c) => c.available()) || null,
    status: () => Object.fromEntries(all.map((c) => [c.id, { available: c.available(), reason: c.reason, keyName: c.keyName }])),
  };
}
