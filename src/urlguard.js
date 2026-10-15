// Guarda de URLs externas (SSRF). A implementação mora em api/_lib/urlguard.mjs (a API da Vercel também usa e não
// leva src/ no pacote); aqui só reexporta, para o robô continuar importando de src/.
export * from '../api/_lib/urlguard.mjs';
