// Validação fail-closed do contrato de entrada do worker.
// Analisa linhas YAML sem depender de regex que possa atravessar blocos ou falhar com CRLF.
export function workerAcceptsDispatchYaml(yaml) {
  if (typeof yaml !== 'string' || !yaml) return false;
  const lines = yaml.split(/\r?\n/);
  const dispatch = lines.findIndex((line) => /^  workflow_dispatch:[ \t]*$/.test(line));
  if (dispatch < 0) return false;
  let inputs = -1;
  for (let i = dispatch + 1; i < lines.length; i++) {
    if (/^  [A-Za-z0-9_-]+:[ \t]*/.test(lines[i])) break;
    if (/^    inputs:[ \t]*$/.test(lines[i])) { inputs = i; break; }
  }
  if (inputs < 0) return false;
  for (let i = inputs + 1; i < lines.length; i++) {
    if (/^    [A-Za-z0-9_-]+:[ \t]*/.test(lines[i])) break;
    if (/^      issue:[ \t]*/.test(lines[i])) return true;
  }
  return false;
}
