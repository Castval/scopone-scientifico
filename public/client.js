// Client Scopone Scientifico

const socket = io();

// Mapping per i nomi dei file delle carte
const NOMI_VALORI = {
  1: 'Asso',
  2: 'Due',
  3: 'Tre',
  4: 'Quattro',
  5: 'Cinque',
  6: 'Sei',
  7: 'Sette',
  8: 'Otto',
  9: 'Nove',
  10: 'Dieci'
};

const OFFSET_SEMI = {
  denari: 0,
  coppe: 10,
  spade: 20,
  bastoni: 30
};

// Genera il percorso dell'immagine per una carta
function getImmagineCarta(valore, seme) {
  const numero = OFFSET_SEMI[seme] + valore;
  const numeroStr = numero.toString().padStart(2, '0');
  const nomeValore = NOMI_VALORI[valore];
  const nomeSeme = (numero === 40) ? 'Bastoni' : seme;
  return `immagini/${numeroStr}_${nomeValore}_di_${nomeSeme}.jpg`;
}

// Stato locale
let statoGioco = null;
let cartaSelezionata = null;
let sessioneCorrente = null;
let carteSelezionateTavolo = [];
let combinazioniDisponibili = [];
let puoiPosare = false;

// Elementi DOM
const schermate = {
  lobby: document.getElementById('lobby'),
  attesa: document.getElementById('attesa'),
  gioco: document.getElementById('gioco'),
  fineRound: document.getElementById('fineRound')
};

// Mostra schermata
function mostraSchermata(nome) {
  Object.values(schermate).forEach(s => s.classList.remove('attiva'));
  schermate[nome].classList.add('attiva');
}

// Crea elemento carta
function creaCarta(carta, clickable = false, nascosta = false) {
  const div = document.createElement('div');
  div.className = 'carta';

  if (nascosta) {
    div.classList.add('dorso');
    return div;
  }

  div.classList.add(carta.seme);
  div.dataset.id = carta.id;

  // Evidenzia settebello
  if (carta.valore === 7 && carta.seme === 'denari') {
    div.classList.add('settebello');
  }

  // Usa immagine della carta
  const imgSrc = getImmagineCarta(carta.valore, carta.seme);
  div.innerHTML = `<img src="${imgSrc}" alt="${carta.valore} di ${carta.seme}">`;

  if (clickable) {
    div.addEventListener('click', () => gestisciClickCarta(carta, div));
  }

  return div;
}

// Gestisce click su carta
function gestisciClickCarta(carta, elemento) {
  // Se e' una carta in mano
  if (statoGioco.manoGiocatore.some(c => c.id === carta.id)) {
    if (!statoGioco.turnoMio) {
      mostraMessaggio('Non è il tuo turno', 'errore');
      return;
    }

    // Deseleziona carta precedente
    if (cartaSelezionata) {
      document.querySelector(`.mano-carte:not(.dorso) .carta[data-id="${cartaSelezionata.id}"]`)?.classList.remove('selezionata');
    }

    // Seleziona nuova carta
    cartaSelezionata = carta;
    elemento.classList.add('selezionata');
    carteSelezionateTavolo = [];

    // Richiedi combinazioni disponibili
    socket.emit('richiediCombinazioni', carta.id);

    // Rimuovi selezioni dal tavolo
    document.querySelectorAll('#tavolo .carta').forEach(c => {
      c.classList.remove('selezionata', 'selezionabile');
    });

    document.getElementById('azioniMossa').classList.add('nascosto');
  }
  // Se e' una carta sul tavolo
  else if (statoGioco.tavolo.some(c => c.id === carta.id)) {
    if (!cartaSelezionata) {
      mostraMessaggio('Prima seleziona una carta dalla tua mano', 'errore');
      return;
    }

    // Toggle selezione
    const idx = carteSelezionateTavolo.findIndex(c => c.id === carta.id);
    if (idx >= 0) {
      carteSelezionateTavolo.splice(idx, 1);
      elemento.classList.remove('selezionata');
    } else {
      carteSelezionateTavolo.push(carta);
      elemento.classList.add('selezionata');
    }

    // Mostra bottoni azione
    aggiornaBottoniAzione();
  }
}

// Aggiorna bottoni azione
function aggiornaBottoniAzione() {
  const azioni = document.getElementById('azioniMossa');
  const btnConferma = document.getElementById('btnConferma');
  const btnPosa = document.getElementById('btnPosa');

  if (carteSelezionateTavolo.length > 0) {
    azioni.classList.remove('nascosto');
    btnConferma.classList.remove('nascosto');
    btnPosa.classList.add('nascosto');
  } else if (puoiPosare && cartaSelezionata) {
    azioni.classList.remove('nascosto');
    btnConferma.classList.add('nascosto');
    btnPosa.classList.remove('nascosto');
  } else {
    if (combinazioniDisponibili.length === 0 && cartaSelezionata) {
      azioni.classList.remove('nascosto');
      btnConferma.classList.add('nascosto');
      btnPosa.classList.remove('nascosto');
    } else {
      azioni.classList.add('nascosto');
    }
  }
}

// Renderizza stato gioco
function renderizzaGioco() {
  if (!statoGioco) return;

  // Info giocatori
  document.getElementById('nomeGiocatoreDisplay').textContent = statoGioco.nomeGiocatore;
  document.getElementById('nomeAvversario').textContent = statoGioco.nomeAvversario || 'Avversario';
  document.getElementById('puntiGiocatore').textContent = statoGioco.puntiGiocatore;
  document.getElementById('puntiAvversario').textContent = statoGioco.puntiAvversario;
  document.getElementById('carteAvversario').textContent = statoGioco.carteAvversario;
  document.getElementById('carteRimanenti').textContent = statoGioco.carteRimanenti;
  document.getElementById('puntiVittoriaDisplay').textContent = statoGioco.puntiVittoria || 21;

  // Turno
  const turnoIndicatore = document.getElementById('turnoIndicatore');
  if (statoGioco.turnoMio) {
    turnoIndicatore.textContent = 'Tocca a te!';
    turnoIndicatore.classList.add('mio-turno');
  } else {
    turnoIndicatore.textContent = 'Turno avversario';
    turnoIndicatore.classList.remove('mio-turno');
  }

  // Mano avversario
  const manoAvversario = document.getElementById('manoAvversario');
  manoAvversario.innerHTML = '';
  for (let i = 0; i < statoGioco.carteAvversario; i++) {
    const carta = document.createElement('div');
    carta.className = 'carta';
    manoAvversario.appendChild(carta);
  }

  // Mazzo prese avversario
  renderizzaMazzoPreseAvversario();

  // Tavolo
  const tavolo = document.getElementById('tavolo');
  tavolo.innerHTML = '';
  for (const carta of statoGioco.tavolo) {
    tavolo.appendChild(creaCarta(carta, true));
  }

  // Mano giocatore
  const manoGiocatore = document.getElementById('manoGiocatore');
  manoGiocatore.innerHTML = '';
  for (const carta of statoGioco.manoGiocatore) {
    manoGiocatore.appendChild(creaCarta(carta, true));
  }

  // Mazzo prese con scope
  renderizzaMazzoPrese();

  // Reset selezione
  cartaSelezionata = null;
  carteSelezionateTavolo = [];
  combinazioniDisponibili = [];
  puoiPosare = false;
  document.getElementById('azioniMossa').classList.add('nascosto');
}

// Renderizza il mazzo delle prese con scope di traverso
function renderizzaMazzoPrese() {
  const mazzoPrese = document.getElementById('mazzoPrese');
  mazzoPrese.innerHTML = '';

  if (!statoGioco) return;

  const numPrese = statoGioco.preseGiocatore;
  const scope = statoGioco.scopeGiocatore || [];

  if (numPrese === 0 && scope.length === 0) return;

  const carteNormaliDaMostrare = Math.min(3, Math.max(1, numPrese - scope.length));

  for (let i = 0; i < carteNormaliDaMostrare; i++) {
    const cartaPresa = document.createElement('div');
    cartaPresa.className = 'carta-presa';
    cartaPresa.style.top = (i * 2) + 'px';
    cartaPresa.style.left = (i * 1) + 'px';
    cartaPresa.style.zIndex = i;
    mazzoPrese.appendChild(cartaPresa);
  }

  const maxScopeVisibili = 7;
  const scopeDaMostrare = scope.slice(-maxScopeVisibili);

  scopeDaMostrare.forEach((scopa, idx) => {
    const parti = scopa.carta.split('_');
    const valore = parseInt(parti[0]);
    const seme = parti[1];

    const cartaScopa = document.createElement('div');
    cartaScopa.className = 'carta-scopa';

    const baseTop = (carteNormaliDaMostrare * 2) + 5;
    cartaScopa.style.top = (baseTop + idx * 18) + 'px';
    cartaScopa.style.left = '-15px';
    cartaScopa.style.zIndex = 50 + idx;

    const imgSrc = getImmagineCarta(valore, seme);
    cartaScopa.innerHTML = `<img src="${imgSrc}" alt="${valore} di ${seme}">`;

    const puntiDiv = document.createElement('div');
    puntiDiv.className = 'scopa-punti';
    puntiDiv.textContent = '+' + scopa.valore;

    cartaScopa.appendChild(puntiDiv);
    mazzoPrese.appendChild(cartaScopa);
  });

  // Contatore
  const contatore = document.createElement('div');
  contatore.className = 'contatore-prese';
  const totaleScope = scope.reduce((sum, s) => sum + s.valore, 0);
  if (scope.length > 0) {
    contatore.innerHTML = `${numPrese} carte<br><strong>${scope.length} scope (+${totaleScope})</strong>`;
  } else {
    contatore.textContent = `${numPrese} carte`;
  }
  mazzoPrese.appendChild(contatore);
}

// Renderizza il mazzo delle prese dell'avversario
function renderizzaMazzoPreseAvversario() {
  const mazzoPrese = document.getElementById('mazzoPreseAvversario');
  mazzoPrese.innerHTML = '';

  if (!statoGioco) return;

  const numPrese = statoGioco.preseAvversario;
  const scope = statoGioco.scopeAvversario || [];

  if (numPrese === 0 && scope.length === 0) return;

  const carteNormaliDaMostrare = Math.min(3, Math.max(1, numPrese - scope.length));

  for (let i = 0; i < carteNormaliDaMostrare; i++) {
    const cartaPresa = document.createElement('div');
    cartaPresa.className = 'carta-presa';
    cartaPresa.style.top = (i * 2) + 'px';
    cartaPresa.style.left = (i * 1) + 'px';
    cartaPresa.style.zIndex = i;
    mazzoPrese.appendChild(cartaPresa);
  }

  const maxScopeVisibili = 7;
  const scopeDaMostrare = scope.slice(-maxScopeVisibili);

  scopeDaMostrare.forEach((scopa, idx) => {
    const parti = scopa.carta.split('_');
    const valore = parseInt(parti[0]);
    const seme = parti[1];

    const cartaScopa = document.createElement('div');
    cartaScopa.className = 'carta-scopa';

    const baseTop = (carteNormaliDaMostrare * 2) + 5;
    cartaScopa.style.top = (baseTop + idx * 18) + 'px';
    cartaScopa.style.left = '-15px';
    cartaScopa.style.zIndex = 50 + idx;

    const imgSrc = getImmagineCarta(valore, seme);
    cartaScopa.innerHTML = `<img src="${imgSrc}" alt="${valore} di ${seme}">`;

    const puntiDiv = document.createElement('div');
    puntiDiv.className = 'scopa-punti';
    puntiDiv.textContent = '+' + scopa.valore;

    cartaScopa.appendChild(puntiDiv);
    mazzoPrese.appendChild(cartaScopa);
  });

  const contatore = document.createElement('div');
  contatore.className = 'contatore-prese';
  const totaleScope = scope.reduce((sum, s) => sum + s.valore, 0);
  if (scope.length > 0) {
    contatore.innerHTML = `${numPrese} carte<br><strong>${scope.length} scope (+${totaleScope})</strong>`;
  } else {
    contatore.textContent = `${numPrese} carte`;
  }
  mazzoPrese.appendChild(contatore);
}

// Mostra messaggio
function mostraMessaggio(testo, tipo = '') {
  const msgLobby = document.getElementById('messaggioLobby');
  const msgGioco = document.getElementById('messaggioGioco');

  const msg = schermate.gioco.classList.contains('attiva') ? msgGioco : msgLobby;

  msg.textContent = testo;
  msg.className = 'messaggio';
  if (tipo) msg.classList.add(tipo);

  setTimeout(() => {
    msg.textContent = '';
    msg.className = 'messaggio';
  }, 3000);
}

// Toggle regole
document.querySelector('.sezione-regole h3')?.addEventListener('click', () => {
  document.querySelector('.sezione-regole').classList.toggle('chiusa');
});

// Event listeners
document.getElementById('btnCreaStanza').addEventListener('click', () => {
  const nome = document.getElementById('nomeGiocatore').value.trim();
  if (!nome) {
    mostraMessaggio('Inserisci il tuo nome', 'errore');
    return;
  }
  const puntiVittoria = parseInt(document.getElementById('puntiVittoria').value);
  sessioneCorrente = { nome };
  socket.emit('creaStanza', { nome, puntiVittoria });
});

document.getElementById('btnUnisciti').addEventListener('click', () => {
  const nome = document.getElementById('nomeGiocatore').value.trim();
  const codice = document.getElementById('codiceStanza').value.trim().toUpperCase();

  if (!nome) {
    mostraMessaggio('Inserisci il tuo nome', 'errore');
    return;
  }
  if (!codice) {
    mostraMessaggio('Inserisci il codice stanza', 'errore');
    return;
  }

  sessioneCorrente = { codice, nome };
  socket.emit('uniscitiStanza', { codice, nome });
});

// Mostra stanze disponibili
document.getElementById('btnMostraStanze').addEventListener('click', () => {
  socket.emit('richiediStanzeDisponibili');
});

document.getElementById('codiceStanza').addEventListener('focus', () => {
  socket.emit('richiediStanzeDisponibili');
});

document.addEventListener('click', (e) => {
  const lista = document.getElementById('listaStanze');
  const container = document.querySelector('.input-stanza-container');
  if (!container.contains(e.target) && !lista.contains(e.target)) {
    lista.classList.add('nascosto');
  }
});

// Ricevi stanze disponibili
socket.on('stanzeDisponibili', (stanze) => {
  const lista = document.getElementById('listaStanze');
  lista.innerHTML = '';

  if (stanze.length === 0) {
    lista.innerHTML = '<div class="nessuna-stanza">Nessuna stanza disponibile</div>';
  } else {
    stanze.forEach(stanza => {
      const item = document.createElement('div');
      item.className = 'stanza-item';
      item.innerHTML = `
        <span class="codice">${stanza.codice}</span>
        <span class="creatore">di ${stanza.creatore} (${stanza.puntiVittoria} pt)</span>
      `;
      item.addEventListener('click', () => {
        document.getElementById('codiceStanza').value = stanza.codice;
        lista.classList.add('nascosto');
      });
      lista.appendChild(item);
    });
  }

  lista.classList.remove('nascosto');
});

document.getElementById('btnConferma').addEventListener('click', () => {
  if (!cartaSelezionata) return;

  socket.emit('giocaCarta', {
    cartaId: cartaSelezionata.id,
    cartePresaIds: carteSelezionateTavolo.map(c => c.id)
  });
});

document.getElementById('btnAnnulla').addEventListener('click', () => {
  cartaSelezionata = null;
  carteSelezionateTavolo = [];
  document.querySelectorAll('.carta.selezionata').forEach(c => c.classList.remove('selezionata'));
  document.querySelectorAll('.carta.selezionabile').forEach(c => c.classList.remove('selezionabile'));
  document.getElementById('azioniMossa').classList.add('nascosto');
});

document.getElementById('btnPosa').addEventListener('click', () => {
  if (!cartaSelezionata) return;

  socket.emit('giocaCarta', {
    cartaId: cartaSelezionata.id,
    cartePresaIds: []
  });
});

document.getElementById('btnProssimoRound').addEventListener('click', () => {
  socket.emit('nuovoRound');
});

document.getElementById('btnNuovaPartita').addEventListener('click', () => {
  socket.emit('nuovaPartita');
});

// Socket events
socket.on('stanzaCreata', ({ codice, nome }) => {
  if (sessioneCorrente) sessioneCorrente.codice = codice;
  document.getElementById('codiceStanzaDisplay').textContent = codice;
  mostraSchermata('attesa');
});

socket.on('unitoAStanza', ({ codice, nome }) => {
  mostraSchermata('attesa');
});

socket.on('errore', (messaggio) => {
  mostraMessaggio(messaggio, 'errore');
});

socket.on('giocatoreUnito', ({ giocatori }) => {
  // Aggiorna UI se necessario
});

socket.on('partitaIniziata', (stato) => {
  statoGioco = stato;
  mostraSchermata('gioco');
  renderizzaGioco();
});

socket.on('statoAggiornato', (dati) => {
  const { cartaGiocata, giocatoreId, ...stato } = dati;

  if (cartaGiocata && giocatoreId !== socket.id) {
    mostraCartaAvversario(cartaGiocata, () => {
      statoGioco = stato;
      renderizzaGioco();
    });
  } else {
    statoGioco = stato;
    renderizzaGioco();
  }
});

// Mostra la carta giocata dall'avversario
function mostraCartaAvversario(carta, callback) {
  const tavoloContainer = document.querySelector('.tavolo-container');

  const cartaDiv = document.createElement('div');
  cartaDiv.className = 'carta carta-avversario-giocata';
  if (carta.valore === 7 && carta.seme === 'denari') {
    cartaDiv.classList.add('settebello');
  }

  const imgSrc = getImmagineCarta(carta.valore, carta.seme);
  cartaDiv.innerHTML = `<img src="${imgSrc}" alt="${carta.valore} di ${carta.seme}">`;

  tavoloContainer.appendChild(cartaDiv);

  setTimeout(() => {
    cartaDiv.remove();
    callback();
  }, 1000);
}

socket.on('combinazioniDisponibili', ({ cartaId, combinazioni, puoiPosare: posare }) => {
  combinazioniDisponibili = combinazioni;
  puoiPosare = posare;

  // Se non ci sono combinazioni possibili, posa automaticamente
  if (cartaSelezionata && combinazioni.length === 0) {
    socket.emit('giocaCarta', {
      cartaId: cartaSelezionata.id,
      cartePresaIds: []
    });
    return;
  }

  // Se c'e' solo una combinazione possibile, prendi automaticamente
  if (cartaSelezionata && combinazioni.length === 1) {
    socket.emit('giocaCarta', {
      cartaId: cartaSelezionata.id,
      cartePresaIds: combinazioni[0]
    });
    return;
  }

  // Evidenzia carte selezionabili
  document.querySelectorAll('#tavolo .carta').forEach(el => {
    el.classList.remove('selezionabile');
    const id = el.dataset.id;
    if (combinazioni.some(comb => comb.includes(id))) {
      el.classList.add('selezionabile');
    }
  });

  aggiornaBottoniAzione();
});

socket.on('mossaNonValida', (errore) => {
  mostraMessaggio(errore, 'errore');
});

socket.on('fineRound', ({ stato, puntiRound, dettagliGiocatore, dettagliAvversario, finePartita, vincitore, pareggio }) => {
  statoGioco = stato;

  const titoloEl = document.getElementById('titoloFineRound');
  const btnProssimo = document.getElementById('btnProssimoRound');
  const btnNuova = document.getElementById('btnNuovaPartita');

  if (finePartita) {
    titoloEl.textContent = vincitore === statoGioco.nomeGiocatore ?
      'Hai vinto!' : `${vincitore} ha vinto!`;
    btnProssimo.classList.add('nascosto');
    btnNuova.classList.remove('nascosto');
  } else if (pareggio) {
    titoloEl.textContent = 'Pareggio! Si continua...';
    btnProssimo.classList.remove('nascosto');
    btnNuova.classList.add('nascosto');
  } else {
    titoloEl.textContent = 'Fine Smazzata';
    btnProssimo.classList.remove('nascosto');
    btnNuova.classList.add('nascosto');
  }

  // Mostra nomi
  document.getElementById('nomeG1').textContent = statoGioco.nomeGiocatore;
  document.getElementById('nomeG2').textContent = statoGioco.nomeAvversario;

  // Dettagli giocatore (G1)
  document.getElementById('scopeG1').textContent = dettagliGiocatore.scope;
  document.getElementById('denariG1').textContent = dettagliGiocatore.denari;
  document.getElementById('carteG1').textContent = dettagliGiocatore.carte;
  document.getElementById('primieraG1').textContent = dettagliGiocatore.primiera;
  document.getElementById('settebelloG1').textContent = dettagliGiocatore.settebello;
  document.getElementById('puntiRoundG1').textContent = dettagliGiocatore.totale;
  document.getElementById('puntiTotaliG1').textContent = statoGioco.puntiGiocatore;

  // Mini carte G1
  renderizzaMiniCarte('carteScopeG1', dettagliGiocatore.carteScope, true);
  renderizzaMiniCarte('cartePrimieraG1', dettagliGiocatore.cartePrimiera);

  // Dettagli avversario (G2)
  document.getElementById('scopeG2').textContent = dettagliAvversario.scope;
  document.getElementById('denariG2').textContent = dettagliAvversario.denari;
  document.getElementById('carteG2').textContent = dettagliAvversario.carte;
  document.getElementById('primieraG2').textContent = dettagliAvversario.primiera;
  document.getElementById('settebelloG2').textContent = dettagliAvversario.settebello;
  document.getElementById('puntiRoundG2').textContent = dettagliAvversario.totale;
  document.getElementById('puntiTotaliG2').textContent = statoGioco.puntiAvversario;

  // Mini carte G2
  renderizzaMiniCarte('carteScopeG2', dettagliAvversario.carteScope, true);
  renderizzaMiniCarte('cartePrimieraG2', dettagliAvversario.cartePrimiera);

  mostraSchermata('fineRound');
});

// Renderizza mini carte nel riepilogo
function renderizzaMiniCarte(elementId, carte, mostraPunti = false) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = '';

  if (!carte || carte.length === 0) return;

  for (const carta of carte) {
    const div = document.createElement('div');
    div.className = 'mini-carta';
    if (mostraPunti && carta.punti) {
      div.classList.add('con-punti');
    }

    const imgSrc = getImmagineCarta(carta.valore, carta.seme);
    div.innerHTML = `<img src="${imgSrc}" alt="${carta.valore} di ${carta.seme}">`;

    if (mostraPunti && carta.punti) {
      const badge = document.createElement('span');
      badge.className = 'punti-badge';
      badge.textContent = '+' + carta.punti;
      div.appendChild(badge);
    }

    container.appendChild(div);
  }
}

socket.on('avversarioDisconnesso', ({ nome, timeout }) => {
  mostraMessaggio(`${nome} si è disconnesso. Attendo riconnessione (${timeout}s)...`, 'info');
});

socket.on('giocatoreRiconnesso', ({ nome }) => {
  mostraMessaggio(`${nome} si è riconnesso!`, 'successo');
});

socket.on('avversarioAbbandonato', ({ nome }) => {
  mostraMessaggio(`${nome} ha abbandonato la partita`, 'errore');
  sessioneCorrente = null;
  setTimeout(() => mostraSchermata('lobby'), 3000);
});

socket.on('connect', () => {
  if (sessioneCorrente && sessioneCorrente.codice && sessioneCorrente.nome) {
    socket.emit('uniscitiStanza', { codice: sessioneCorrente.codice, nome: sessioneCorrente.nome });
  }
});
