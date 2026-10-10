// A política do preço Copag vive em api/_lib (a Vercel só publica api/ e o site; src/ não vai para a função).
// Robô e API usam o MESMO código; test/data-quality-tests.js confere a paridade nos mesmos casos.
export * from '../api/_lib/copag-policy.mjs';
