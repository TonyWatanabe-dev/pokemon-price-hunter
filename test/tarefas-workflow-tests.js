// Workflow de tarefas paralelas: segurança do gatilho, permissões, concorrência e resultado final.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, '.github/workflows/tarefas.yml'), 'utf8');
const code = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
const firewall = fs.readFileSync(path.join(root, '.github/egress-firewall.yaml'), 'utf8');
const firewallCode = firewall.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
/** Bloco de um job (do "  nome:" até o próximo job de mesmo recuo). */
const job = (name) => { const m = code.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [\\w-]+:\\n|$)`)); assert.ok(m, `job ${name}`); return m[1]; };

await t('1. só dispara com label em issue; nada de PR de terceiros, comentário ou pull_request_target', () => {
  assert.match(code, /^on:\n  issues:\n    types: \[labeled\]\n/m);
  for (const ev of ['pull_request', 'pull_request_target', 'issue_comment', 'workflow_run', 'push', 'schedule']) assert.doesNotMatch(code, new RegExp(`^  ${ev}:`, 'm'), ev);
});

await t('2. só o label executor:github, issue aberta, e operador tanto em quem aplicou quanto em quem abriu a issue', () => {
  const v = job('vaga');
  assert.match(v, /github\.event\.label\.name == 'executor:github'/);
  assert.match(v, /github\.event\.issue\.state == 'open'/);
  const ops = "vars.TAREFAS_OPERADORES || github.repository_owner";
  for (const who of ['github.event.sender.login', 'github.event.issue.user.login'])
    assert.ok(v.includes(`contains(format(',{0},', ${ops}), format(',{0},', ${who}))`), who);
  assert.doesNotMatch(code, /executor:ready/, 'não disputa issues com o executor local');
});

await t('3. permissões mínimas: nada no topo nem na vaga; escrita só no job da tarefa', () => {
  assert.match(code, /^permissions: \{\}$/m);
  assert.doesNotMatch(job('vaga'), /permissions:/);
  const p = job('tarefa').match(/permissions:\n((?: {6}.+\n)+)/)[1];
  const got = Object.fromEntries(p.trim().split('\n').map((l) => l.trim().replace(/\s+#.*$/, '').split(/:\s*/)));
  assert.deepEqual(got, { contents: 'write', 'pull-requests': 'write', issues: 'write', 'id-token': 'write', actions: 'read' });
  assert.doesNotMatch(code, /workflows:\s*write|administration|secrets:\s*write/);
});

await t('4. paralelismo por vagas: grupo pela vaga, sem cancelar, com fila (queue: max)', () => {
  const c = job('tarefa').match(/concurrency:\n((?: {6}.+\n)+)/)[1];
  assert.match(c, /group: tarefas-vaga-\$\{\{ needs\.vaga\.outputs\.n \}\}/);
  assert.match(c, /cancel-in-progress: false/);
  assert.match(c, /queue: max/);
  assert.match(job('tarefa'), /needs: vaga/);
});

await t('5. cálculo da vaga: issue % TAREFAS_MAX, padrão 3, limitado a 1..10 e imune a valor inválido', () => {
  const script = job('vaga').match(/run: \|\n((?: {10}.*\n?)+)/)[1].replace(/^ {10}/gm, '');
  const slot = (ISSUE, MAX) => {
    const out = path.join(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'vaga-')), 'out');
    execFileSync('bash', ['-c', script], { env: { PATH: process.env.PATH, ISSUE: String(ISSUE), MAX, GITHUB_OUTPUT: out } });
    return fs.readFileSync(out, 'utf8').trim();
  };
  assert.equal(slot(7, '3'), 'n=1'); assert.equal(slot(9, '3'), 'n=0');
  assert.equal(slot(7, ''), 'n=1', 'padrão 3'); assert.equal(slot(7, 'abc'), 'n=1', 'inválido vira 3');
  assert.equal(slot(7, '0'), 'n=0', 'mínimo 1'); assert.equal(slot(25, '50'), 'n=5', 'máximo 10');
  assert.equal(slot(123, '1'), 'n=0', 'TAREFAS_MAX=1 vira fila única');
});

await t('6. secrets mínimos: só o token do Claude; banco descartável; nada de Vercel/PAT ou logs completos', () => {
  const secrets = [...code.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(secrets, ['CLAUDE_CODE_OAUTH_TOKEN']);
  assert.doesNotMatch(code, /DATABASE_URL:\s*\$\{\{|VERCEL|PG_CA_CERT/);
  assert.match(code, /TEST_DATABASE_URL: postgres:\/\/postgres:pw@localhost:5432\/postgres/, 'só o banco descartável do job');
  assert.doesNotMatch(code, /show_full_output:\s*true|allowed_non_write_users|allowed_bots/);
});

await t('7. ferramentas restritas: sem Bash livre, push forçado ou merge', () => {
  const tools = code.match(/--allowedTools "([^"]+)"/)[1].split(',');
  for (const tool of tools) assert.match(tool, /^Bash\((npm test|npm ci|node test\/\*|git status|git diff:\*|git log:\*|gh pr create:\*|gh pr list:\*)\)$/, tool);
  assert.doesNotMatch(code, /Bash\(\*\)|Bash\(git push|gh pr merge|--dangerously/);
  assert.match(code, /include_comments_by_actor: \$\{\{ vars\.TAREFAS_OPERADORES \|\| github\.repository_owner \}\}/);
  assert.match(code, /--max-turns \d+/);
});

await t('8. instruções fixas: seguir CLAUDE.md; sem deploy/produção/workflows; testar e abrir PR', () => {
  const p = code.match(/--append-system-prompt "([^"]+)"/)[1];
  for (const s of ['CLAUDE.md', 'nunca na main', 'nunca force-push', '.github/workflows', '.github/egress-firewall.yaml', 'não faça deploy', 'banco de produção', 'npm test', 'gh pr create --base main', 'Closes #', 'não invente'])
    assert.ok(p.includes(s), s);
});

await t('9. ação do Claude fixada por SHA verificado, permission-mode auto e timeout abaixo de 60 min', () => {
  assert.match(code, /uses: anthropics\/claude-code-action@1d6de8cb0c237e7c15e9e1bdf973826ebae490cc # v1\.0\.248/);
  assert.match(code, /--permission-mode auto/);
  const mins = Number(job('tarefa').match(/timeout-minutes: (\d+)/)[1]); assert.ok(mins > 0 && mins < 60, `${mins}`);
  assert.match(job('vaga'), /timeout-minutes: \d+/);
});

await t('10. runner com firewall; allowlist em modo enforce e sem wildcards', () => {
  assert.match(job('tarefa'), /runs-on: ubuntu-24\.04-firewall/);
  assert.match(firewallCode, /^mode: enforce$/m);
  assert.match(firewallCode, /- api\.anthropic\.com/);
  assert.match(firewallCode, /- api\.github\.com/);
  assert.match(firewallCode, /- registry\.npmjs\.org/);
  assert.doesNotMatch(firewallCode, /\*/);
});

await t('11. resultado só marca done após sucesso do Claude e PR aberta; se falhar, preserva link de triagem', () => {
  assert.match(code, /DELETE "repos\/\$REPO\/issues\/\$ISSUE\/labels\/executor:github"/);
  assert.match(code, /name: Resultado na issue\n\s+if: always\(\)/);
  assert.match(code, /CLAUDE_CONCLUSION: \$\{\{ steps\.claude\.outputs\.conclusion \}\}/);
  assert.match(code, /\[ "\$CLAUDE_CONCLUSION" = "success" \] && \[ -n "\$pr" \]/);
  assert.match(code, /labels\[\]=executor:done/); assert.match(code, /labels\[\]=executor:failed/);
  assert.match(code, /PR existe e precisa de triagem: \$pr/);
});

console.log(`✓ Tarefas paralelas (workflow): ${n} grupos de testes passaram`);
