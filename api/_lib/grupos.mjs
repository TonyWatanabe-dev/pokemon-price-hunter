// Grupos de ofertas do TCG Price Hunter (convites informados pelo dono). Única fonte no servidor; o site
// (index.html, const GRUPOS) carrega uma cópia literal e test/grupos-page-tests.js confere que são iguais.
export const GRUPOS = Object.freeze({
  whatsapp: 'https://chat.whatsapp.com/BshJHzdMsWx6MkmRDKt8Dv',
  telegram: 'https://t.me/+LzS_Jp1Wvas2NDhh',
});

// Perfis públicos do TCG Price Hunter (informados pelo dono; docs/ROADMAP-OPERACIONAL.md, canais de Social Media).
// Mesma regra: index.html carrega cópia literal (const REDES) e test/redes-sociais-tests.js confere.
export const REDES = Object.freeze({
  instagram: 'https://www.instagram.com/tcgpricehunter151/',
  tiktok: 'https://www.tiktok.com/@tcgpricehunter',
  youtube: 'https://www.youtube.com/channel/UCiePh0ZymWoPwa8k1d2jrDg',
  facebook: 'https://www.facebook.com/profile.php?id=61595339254811',
});
