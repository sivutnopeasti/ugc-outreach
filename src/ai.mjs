/**
 * Valinnainen OpenAI-yhteensopiva rajapinta.
 * Ilman AI_API_KEY / OPENAI_API_KEY -avaimia ei tehdä yhtään kutsua.
 * Sopii myös ilmaisiin tai lähes ilmaisiin malleihin (esim. Groq, OpenRouter).
 */

export function aiConfig(env = process.env) {
  const apiKey = env.AI_API_KEY || env.OPENAI_API_KEY || '';
  return {
    enabled: Boolean(apiKey),
    apiKey,
    baseUrl: (env.AI_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: env.AI_MODEL || env.OPENAI_MODEL || 'gpt-4o-mini',
  };
}

export async function suggestInstagramHandles({ companyName, website, pageText }, config, fetchImpl = fetch) {
  if (!config.enabled) return [];
  const prompt = [
    'Ehdota enintään 8 todennäköistä Instagram-käyttäjänimeä suomalaiselle yritykselle.',
    'Käytä yritysnimeä, brändiä, lyhenteitä ja suomenkielisiä muunnelmia (ilman @-merkkiä).',
    'Älä päätä mikä on oikea tili — vain ehdota kahvoja tarkistettavaksi.',
    'Palauta vain JSON-taulukko merkkijonoina, ei markdownia.',
    `Yritys: ${companyName}`,
    website ? `Verkkosivu: ${website}` : '',
    pageText ? `Sivun ote: ${pageText.slice(0, 1200)}` : '',
  ].filter(Boolean).join('\n');

  const content = await chat(config, prompt, fetchImpl);
  return parseHandleList(content);
}

export async function polishOutreachMessage(message, { companyName }, config, fetchImpl = fetch) {
  if (!config.enabled) return message;
  const prompt = [
    'Kirjoita suomeksi lyhyt B2B-sähköposti yritykselle. Säilytä nämä faktat:',
    `- yritys: ${companyName}`,
    `- lomake: ${message.text.match(/https:\/\/ugcsuomi\.fi\/[^\s]+/)?.[0] || ''}`,
    '- viesti on markkinointiviesti',
    '- vastaanottaja voi vastata "Ei kiitos"',
    'Älä keksi seuraajamääriä. Palauta vain viestin runkoteksti ilman aihetta.',
    'Alkuperäinen:',
    message.text,
  ].join('\n');
  const text = (await chat(config, prompt, fetchImpl)).trim();
  if (!text || text.length < 40) return message;
  return {
    ...message,
    text,
    html: `<!doctype html><html lang="fi"><body style="font-family:Georgia,serif;line-height:1.5;color:#1f2933;">${
      escapeHtml(text).replaceAll('\n\n', '</p><p>').replaceAll('\n', '<br>')
    }</p></body></html>`.replace('<body style="font-family:Georgia,serif;line-height:1.5;color:#1f2933;">', '<body style="font-family:Georgia,serif;line-height:1.5;color:#1f2933;"><p>'),
  };
}

async function chat(config, prompt, fetchImpl) {
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Vastaa tiiviisti ja noudata ohjeita.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AI-kutsu epäonnistui (${response.status}): ${body.slice(0, 200)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export function parseHandleList(content) {
  const text = String(content || '').trim();
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).replace(/^@/, '').trim()).filter(Boolean);
      }
    }
  } catch {
    /* fall through */
  }
  return [...text.matchAll(/@?([A-Za-z0-9._]{2,30})/g)].map((match) => match[1]);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
