export const CAMPAIGN_FORM_URL = 'https://ugcsuomi.fi/ilmoita-kampanjasta-sisallontuottajille/';
export const CREATOR_CHAT_URL = 'https://ugcsuomi.fi/ugc-chat/';

export function buildMessage({ companyName, businessId, instagramUrl, reasons, fromName, fromEmail, postalAddress }) {
  const observation = reasons.length ? reasons.join(', ') : 'julkinen näkyvyys jäi ohueksi';
  const senderBlock = [fromName, postalAddress, fromEmail].filter(Boolean).join('\n');
  const subject = `Sisällöntuottaja yritykselle ${companyName}`;
  const text = [
    'Hei,',
    '',
    `katselimme yrityksen ${companyName} (${businessId}) julkista Instagram-näkyvyyttä. ${observation}.`,
    instagramUrl ? `Julkinen tili: ${instagramUrl}` : '',
    '',
    'UGC Suomi kokoaa suomalaisia sisällöntuottajia, joita yritys voi hakea ilmaiseksi. Täyttäkää lomake, niin tekijät näkevät toimeksiannon ja voivat tarjoutua teille:',
    CAMPAIGN_FORM_URL,
    '',
    'Tekijän voi etsiä myös kuvailemalla tarpeen omin sanoin:',
    CREATOR_CHAT_URL,
    '',
    'Tämä on yrityksellenne osoitettu markkinointiviesti. Jos ette halua vastaavia viestejä, vastatkaa tähän viestiin sanoilla "Ei kiitos".',
    '',
    senderBlock,
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');

  const html = `<!doctype html>
<html lang="fi">
<body style="font-family: Georgia, serif; color: #1f2933; line-height: 1.5;">
  <p>Hei,</p>
  <p>katselimme yrityksen <strong>${escapeHtml(companyName)}</strong> (${escapeHtml(businessId)}) julkista Instagram-näkyvyyttä. ${escapeHtml(observation)}.</p>
  ${instagramUrl ? `<p>Julkinen tili: <a href="${escapeHtml(instagramUrl)}">${escapeHtml(instagramUrl)}</a></p>` : ''}
  <p>UGC Suomi kokoaa suomalaisia sisällöntuottajia, joita yritys voi hakea ilmaiseksi. Täyttäkää lomake, niin tekijät näkevät toimeksiannon ja voivat tarjoutua teille:</p>
  <p><a href="${CAMPAIGN_FORM_URL}">${CAMPAIGN_FORM_URL}</a></p>
  <p>Tekijän voi etsiä myös kuvailemalla tarpeen omin sanoin:</p>
  <p><a href="${CREATOR_CHAT_URL}">${CREATOR_CHAT_URL}</a></p>
  <p>Tämä on yrityksellenne osoitettu markkinointiviesti. Jos ette halua vastaavia viestejä, vastatkaa tähän viestiin sanoilla "Ei kiitos".</p>
  <p>${escapeHtml(senderBlock).replaceAll('\n', '<br>')}</p>
</body>
</html>`;

  return { subject, text, html };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
