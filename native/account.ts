// The StarHermit account strings (sign-in, invite, toasts, the results' leaderboard line) in the nine
// locales, from the browser build's gfx-i18n.js SH_STRINGS.

export interface AccountStrings {
  signIn: string;
  signInSub: string;
  invite: string;
  inviteSub: string;
  copied: string;
  copyFailed: string;
  signedOut: string;
  lbPosting: string;
  lbRank: string;
  lbPosted: string;
  lbFailed: string;
}

export const SH_STRINGS: Record<string, AccountStrings> = {
  "en-US": {
    signIn: "Sign in with StarHermit",
    signInSub: "Sync progress and settings to your account.",
    invite: "Invite a friend",
    inviteSub: "Copy your invite link.",
    copied: "Invite link copied to the clipboard.",
    copyFailed: "Could not copy the invite link.",
    signedOut: "Signed out — playing locally.",
    lbPosting: "Posting score to the leaderboard…",
    lbRank: "Leaderboard rank: #{rank}",
    lbPosted: "Score posted to the leaderboard.",
    lbFailed: "Score not posted to the leaderboard.",
  },
  "en-GB": {
    signIn: "Sign in with StarHermit",
    signInSub: "Sync progress and settings to your account.",
    invite: "Invite a friend",
    inviteSub: "Copy your invite link.",
    copied: "Invite link copied to the clipboard.",
    copyFailed: "Couldn’t copy the invite link.",
    signedOut: "Signed out — playing locally.",
    lbPosting: "Posting score to the leaderboard…",
    lbRank: "Leaderboard rank: #{rank}",
    lbPosted: "Score posted to the leaderboard.",
    lbFailed: "Score not posted to the leaderboard.",
  },
  "es-419": {
    signIn: "Iniciar sesión con StarHermit",
    signInSub: "Sincroniza tu progreso y ajustes con tu cuenta.",
    invite: "Invitar a un amigo",
    inviteSub: "Copia tu enlace de invitación.",
    copied: "Enlace de invitación copiado al portapapeles.",
    copyFailed: "No se pudo copiar el enlace de invitación.",
    signedOut: "Sesión cerrada: juegas en modo local.",
    lbPosting: "Publicando la puntuación en la clasificación…",
    lbRank: "Puesto en la clasificación: #{rank}",
    lbPosted: "Puntuación publicada en la clasificación.",
    lbFailed: "No se publicó la puntuación en la clasificación.",
  },
  "es-ES": {
    signIn: "Iniciar sesión con StarHermit",
    signInSub: "Sincroniza tu progreso y tus ajustes con tu cuenta.",
    invite: "Invitar a un amigo",
    inviteSub: "Copia tu enlace de invitación.",
    copied: "Enlace de invitación copiado al portapapeles.",
    copyFailed: "No se ha podido copiar el enlace de invitación.",
    signedOut: "Sesión cerrada: juegas en local.",
    lbPosting: "Publicando la puntuación en la clasificación…",
    lbRank: "Puesto en la clasificación: #{rank}",
    lbPosted: "Puntuación publicada en la clasificación.",
    lbFailed: "No se ha publicado la puntuación en la clasificación.",
  },
  "de-DE": {
    signIn: "Mit StarHermit anmelden",
    signInSub: "Fortschritt und Einstellungen mit deinem Konto synchronisieren.",
    invite: "Freund einladen",
    inviteSub: "Einladungslink kopieren.",
    copied: "Einladungslink in die Zwischenablage kopiert.",
    copyFailed: "Einladungslink konnte nicht kopiert werden.",
    signedOut: "Abgemeldet – du spielst lokal weiter.",
    lbPosting: "Punktzahl wird in die Bestenliste eingetragen…",
    lbRank: "Platz in der Bestenliste: #{rank}",
    lbPosted: "Punktzahl in die Bestenliste eingetragen.",
    lbFailed: "Punktzahl nicht in die Bestenliste eingetragen.",
  },
  "fr-FR": {
    signIn: "Se connecter avec StarHermit",
    signInSub: "Synchronisez progression et réglages avec votre compte.",
    invite: "Inviter un ami",
    inviteSub: "Copier votre lien d’invitation.",
    copied: "Lien d’invitation copié dans le presse-papiers.",
    copyFailed: "Impossible de copier le lien d’invitation.",
    signedOut: "Déconnecté — vous jouez en local.",
    lbPosting: "Envoi du score au classement…",
    lbRank: "Rang au classement : #{rank}",
    lbPosted: "Score envoyé au classement.",
    lbFailed: "Score non envoyé au classement.",
  },
  "fr-CA": {
    signIn: "Se connecter avec StarHermit",
    signInSub: "Synchronisez votre progression et vos paramètres avec votre compte.",
    invite: "Inviter un ami",
    inviteSub: "Copier votre lien d’invitation.",
    copied: "Lien d’invitation copié dans le presse-papiers.",
    copyFailed: "Impossible de copier le lien d’invitation.",
    signedOut: "Déconnecté — vous jouez en local.",
    lbPosting: "Envoi du pointage au classement…",
    lbRank: "Rang au classement : #{rank}",
    lbPosted: "Pointage envoyé au classement.",
    lbFailed: "Pointage non envoyé au classement.",
  },
  "pt-BR": {
    signIn: "Entrar com StarHermit",
    signInSub: "Sincronize progresso e configurações com sua conta.",
    invite: "Convidar um amigo",
    inviteSub: "Copie seu link de convite.",
    copied: "Link de convite copiado para a área de transferência.",
    copyFailed: "Não foi possível copiar o link de convite.",
    signedOut: "Sessão encerrada — jogando localmente.",
    lbPosting: "Enviando a pontuação para o ranking…",
    lbRank: "Posição no ranking: #{rank}",
    lbPosted: "Pontuação enviada para o ranking.",
    lbFailed: "Pontuação não enviada para o ranking.",
  },
  "it-IT": {
    signIn: "Accedi con StarHermit",
    signInSub: "Sincronizza progressi e impostazioni con il tuo account.",
    invite: "Invita un amico",
    inviteSub: "Copia il tuo link di invito.",
    copied: "Link di invito copiato negli appunti.",
    copyFailed: "Impossibile copiare il link di invito.",
    signedOut: "Disconnesso: giochi in locale.",
    lbPosting: "Invio del punteggio alla classifica…",
    lbRank: "Posizione in classifica: #{rank}",
    lbPosted: "Punteggio inviato alla classifica.",
    lbFailed: "Punteggio non inviato alla classifica.",
  },
};
