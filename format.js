export const money = (v) => v == null ? '-' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = (v, d = 1) => v == null ? '-' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
