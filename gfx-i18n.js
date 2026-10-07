'use strict';

// Mosaic Pieces — strings for the Graphics settings section, in every
// required locale. The rest of the game is en-US only (spec §10); this panel
// picks its locale from navigator.language.

const en = {
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra',
  renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device; the scene renders without it.',
  noWebgl: '3D rendering is unavailable, so these settings have no effect.',
  cat: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail', particles: 'Particles' },
  tier: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed' },
  sum: { noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', reflections: 'reflections', noAa: 'no anti-aliasing', unknownGpu: 'unknown GPU' }
};
const enGB = { ...en,
  cat: { ...en.cat, grade: 'Colour grade' }
};
const es = {
  graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
  low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Escala de renderizado', fromPreset: 'Del ajuste ({tier})',
  adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo; la escena se muestra sin él.',
  noWebgl: 'El renderizado 3D no está disponible, así que estos ajustes no tienen efecto.',
  cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Suavizado de bordes', reflections: 'Reflejos', detail: 'Detalle de superficies', particles: 'Partículas' },
  tier: { off: 'No', on: 'Sí', low: 'Bajas', medium: 'Medias', high: 'Altas', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado' },
  sum: { noShadows: 'sin sombras', shadows: 'sombras {n}²', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', reflections: 'reflejos', noAa: 'sin suavizado', unknownGpu: 'GPU desconocida' }
};
const es419 = { ...es,
  adaptive: 'Resolución adaptable', showFps: 'Mostrar cuadros por segundo',
  sum: { ...es.sum }
};
const de = {
  graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
  low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra',
  renderScale: 'Renderskalierung', fromPreset: 'Aus Voreinstellung ({tier})',
  adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
  postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; die Szene wird ohne sie dargestellt.',
  noWebgl: '3D-Darstellung ist nicht verfügbar, daher haben diese Einstellungen keine Wirkung.',
  cat: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur', antialias: 'Kantenglättung', reflections: 'Spiegelungen', detail: 'Oberflächendetails', particles: 'Partikel' },
  tier: { off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Schlicht', detailed: 'Detailliert' },
  sum: { noShadows: 'keine Schatten', shadows: '{n}²-Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung', bloom: 'Leuchteffekt', reflections: 'Spiegelungen', noAa: 'keine Kantenglättung', unknownGpu: 'unbekannte GPU' }
};
const fr = {
  graphics: 'Graphismes', quality: 'Qualité', auto: 'Automatique (détectée : {tier})',
  low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra',
  renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
  adaptive: 'Résolution adaptative', showFps: 'Afficher la fréquence d’images',
  postFailed: 'Le post-traitement n’est pas disponible sur cet appareil ; la scène s’affiche sans.',
  noWebgl: 'Le rendu 3D n’est pas disponible ; ces réglages sont sans effet.',
  cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs', antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces', particles: 'Particules' },
  tier: { off: 'Désactivé', on: 'Activé', low: 'Basses', medium: 'Moyennes', high: 'Hautes', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé' },
  sum: { noShadows: 'sans ombres', shadows: 'ombres {n}²', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète', bloom: 'halo', reflections: 'reflets', noAa: 'sans anticrénelage', unknownGpu: 'GPU inconnu' }
};
const frCA = { ...fr,
  showFps: 'Afficher le nombre d’images par seconde',
  cat: { ...fr.cat, antialias: 'Lissage des contours' },
  sum: { ...fr.sum, noAa: 'sans lissage' }
};
const pt = {
  graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
  low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Escala de renderização', fromPreset: 'Da predefinição ({tier})',
  adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
  postFailed: 'O pós-processamento não está disponível neste dispositivo; a cena é exibida sem ele.',
  noWebgl: 'A renderização 3D não está disponível, então estas opções não têm efeito.',
  cat: { shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Suavização de bordas', reflections: 'Reflexos', detail: 'Detalhe das superfícies', particles: 'Partículas' },
  tier: { off: 'Desligado', on: 'Ligado', low: 'Baixas', medium: 'Médias', high: 'Altas', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado' },
  sum: { noShadows: 'sem sombras', shadows: 'sombras {n}²', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa', bloom: 'brilho', reflections: 'reflexos', noAa: 'sem suavização', unknownGpu: 'GPU desconhecida' }
};
const it = {
  graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
  low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra',
  renderScale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})',
  adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
  postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; la scena viene mostrata senza.',
  noWebgl: 'Il rendering 3D non è disponibile, quindi queste impostazioni non hanno effetto.',
  cat: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing', reflections: 'Riflessi', detail: 'Dettaglio superfici', particles: 'Particelle' },
  tier: { off: 'No', on: 'Sì', low: 'Basse', medium: 'Medie', high: 'Alte', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato' },
  sum: { noShadows: 'senza ombre', shadows: 'ombre {n}²', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa', bloom: 'bagliore', reflections: 'riflessi', noAa: 'senza antialiasing', unknownGpu: 'GPU sconosciuta' }
};

export const GFX_STRINGS = {
  'en-US': en, 'en-GB': enGB, 'es-419': es419, 'es-ES': es, 'de-DE': de,
  'fr-FR': fr, 'fr-CA': frCA, 'pt-BR': pt, 'it-IT': it
};

/** Best supported locale for a BCP-47 tag (exact, then regional family, then en-US). */
export function pickLocale(tag) {
  const t = String(tag || 'en-US');
  if (GFX_STRINGS[t]) return t;
  const [lang, region = ''] = t.split('-');
  const r = region.toUpperCase();
  if (lang === 'en') return ['GB', 'IE', 'AU', 'NZ', 'ZA', 'IN'].includes(r) ? 'en-GB' : 'en-US';
  if (lang === 'es') return r === 'ES' ? 'es-ES' : (r ? 'es-419' : 'es-ES');
  if (lang === 'fr') return r === 'CA' ? 'fr-CA' : 'fr-FR';
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'de') return 'de-DE';
  if (lang === 'it') return 'it-IT';
  return 'en-US';
}

export function gfxStrings(tag) {
  return GFX_STRINGS[pickLocale(tag)];
}

// StarHermit account strings (sign-in / invite buttons and toasts), every
// required locale; same locale pick as the Graphics section.
const SH_STRINGS = {
  'en-US': { signIn: 'Sign in with StarHermit', signInSub: 'Sync progress and settings to your account.', invite: 'Invite a friend', inviteSub: 'Copy your invite link.', copied: 'Invite link copied to the clipboard.', copyFailed: 'Could not copy the invite link.', signedOut: 'Signed out — playing locally.', lbPosting: 'Posting score to the leaderboard…', lbRank: 'Leaderboard rank: #{rank}', lbPosted: 'Score posted to the leaderboard.', lbFailed: 'Score not posted to the leaderboard.' },
  'en-GB': { signIn: 'Sign in with StarHermit', signInSub: 'Sync progress and settings to your account.', invite: 'Invite a friend', inviteSub: 'Copy your invite link.', copied: 'Invite link copied to the clipboard.', copyFailed: 'Couldn’t copy the invite link.', signedOut: 'Signed out — playing locally.', lbPosting: 'Posting score to the leaderboard…', lbRank: 'Leaderboard rank: #{rank}', lbPosted: 'Score posted to the leaderboard.', lbFailed: 'Score not posted to the leaderboard.' },
  'es-419': { signIn: 'Iniciar sesión con StarHermit', signInSub: 'Sincroniza tu progreso y ajustes con tu cuenta.', invite: 'Invitar a un amigo', inviteSub: 'Copia tu enlace de invitación.', copied: 'Enlace de invitación copiado al portapapeles.', copyFailed: 'No se pudo copiar el enlace de invitación.', signedOut: 'Sesión cerrada: juegas en modo local.', lbPosting: 'Publicando la puntuación en la clasificación…', lbRank: 'Puesto en la clasificación: #{rank}', lbPosted: 'Puntuación publicada en la clasificación.', lbFailed: 'No se publicó la puntuación en la clasificación.' },
  'es-ES': { signIn: 'Iniciar sesión con StarHermit', signInSub: 'Sincroniza tu progreso y tus ajustes con tu cuenta.', invite: 'Invitar a un amigo', inviteSub: 'Copia tu enlace de invitación.', copied: 'Enlace de invitación copiado al portapapeles.', copyFailed: 'No se ha podido copiar el enlace de invitación.', signedOut: 'Sesión cerrada: juegas en local.', lbPosting: 'Publicando la puntuación en la clasificación…', lbRank: 'Puesto en la clasificación: #{rank}', lbPosted: 'Puntuación publicada en la clasificación.', lbFailed: 'No se ha publicado la puntuación en la clasificación.' },
  'de-DE': { signIn: 'Mit StarHermit anmelden', signInSub: 'Fortschritt und Einstellungen mit deinem Konto synchronisieren.', invite: 'Freund einladen', inviteSub: 'Einladungslink kopieren.', copied: 'Einladungslink in die Zwischenablage kopiert.', copyFailed: 'Einladungslink konnte nicht kopiert werden.', signedOut: 'Abgemeldet – du spielst lokal weiter.', lbPosting: 'Punktzahl wird in die Bestenliste eingetragen…', lbRank: 'Platz in der Bestenliste: #{rank}', lbPosted: 'Punktzahl in die Bestenliste eingetragen.', lbFailed: 'Punktzahl nicht in die Bestenliste eingetragen.' },
  'fr-FR': { signIn: 'Se connecter avec StarHermit', signInSub: 'Synchronisez progression et réglages avec votre compte.', invite: 'Inviter un ami', inviteSub: 'Copier votre lien d’invitation.', copied: 'Lien d’invitation copié dans le presse-papiers.', copyFailed: 'Impossible de copier le lien d’invitation.', signedOut: 'Déconnecté — vous jouez en local.', lbPosting: 'Envoi du score au classement…', lbRank: 'Rang au classement : #{rank}', lbPosted: 'Score envoyé au classement.', lbFailed: 'Score non envoyé au classement.' },
  'fr-CA': { signIn: 'Se connecter avec StarHermit', signInSub: 'Synchronisez votre progression et vos paramètres avec votre compte.', invite: 'Inviter un ami', inviteSub: 'Copier votre lien d’invitation.', copied: 'Lien d’invitation copié dans le presse-papiers.', copyFailed: 'Impossible de copier le lien d’invitation.', signedOut: 'Déconnecté — vous jouez en local.', lbPosting: 'Envoi du pointage au classement…', lbRank: 'Rang au classement : #{rank}', lbPosted: 'Pointage envoyé au classement.', lbFailed: 'Pointage non envoyé au classement.' },
  'pt-BR': { signIn: 'Entrar com StarHermit', signInSub: 'Sincronize progresso e configurações com sua conta.', invite: 'Convidar um amigo', inviteSub: 'Copie seu link de convite.', copied: 'Link de convite copiado para a área de transferência.', copyFailed: 'Não foi possível copiar o link de convite.', signedOut: 'Sessão encerrada — jogando localmente.', lbPosting: 'Enviando a pontuação para o ranking…', lbRank: 'Posição no ranking: #{rank}', lbPosted: 'Pontuação enviada para o ranking.', lbFailed: 'Pontuação não enviada para o ranking.' },
  'it-IT': { signIn: 'Accedi con StarHermit', signInSub: 'Sincronizza progressi e impostazioni con il tuo account.', invite: 'Invita un amico', inviteSub: 'Copia il tuo link di invito.', copied: 'Link di invito copiato negli appunti.', copyFailed: 'Impossibile copiare il link di invito.', signedOut: 'Disconnesso: giochi in locale.', lbPosting: 'Invio del punteggio alla classifica…', lbRank: 'Posizione in classifica: #{rank}', lbPosted: 'Punteggio inviato alla classifica.', lbFailed: 'Punteggio non inviato alla classifica.' }
};
export function shStrings(tag) {
  return SH_STRINGS[pickLocale(tag)];
}
