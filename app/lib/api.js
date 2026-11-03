export async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new Error(
      /request entity too large/i.test(snippet)
        ? 'Palvelin hylkäsi liian ison vastauksen. Kokeile pienempää CSV:tä tai lataa sivu uudelleen.'
        : `Palvelin palautti odottamattoman vastauksen: ${snippet || res.status}`,
    );
  }
}
