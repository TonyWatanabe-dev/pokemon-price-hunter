// Validação fail-closed do contrato de entrada do worker.
export function workerAcceptsDispatchYaml(yaml) {
  return /\n[ \t]*workflow_dispatch:[ \t]*\n[\s\S]*?\n[ \t]+inputs:[ \t]*\n[\s\S]*?\n[ \t]+issue:/.test(yaml);
}
