const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { ScoponeScientifico } = require('./game-logic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Stanze di gioco
const stanze = new Map();

// Genera codice stanza
function generaCodiceStanza() {
  const caratteri = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let codice = '';
  for (let i = 0; i < 6; i++) {
    codice += caratteri.charAt(Math.floor(Math.random() * caratteri.length));
  }
  return codice;
}

io.on('connection', (socket) => {
  console.log(`Giocatore connesso: ${socket.id}`);

  // Richiedi stanze disponibili
  socket.on('richiediStanzeDisponibili', () => {
    const stanzeDisponibili = [];
    for (const [codice, partita] of stanze) {
      if (partita.giocatori.length === 1 && partita.stato === 'attesa') {
        stanzeDisponibili.push({
          codice: codice,
          creatore: partita.giocatori[0].nome,
          puntiVittoria: partita.puntiVittoria
        });
      }
    }
    socket.emit('stanzeDisponibili', stanzeDisponibili);
  });

  // Crea nuova stanza
  socket.on('creaStanza', ({ nome, puntiVittoria }) => {
    const codice = generaCodiceStanza();
    const punti = [7, 11, 16, 21, 31].includes(puntiVittoria) ? puntiVittoria : 21;
    const partita = new ScoponeScientifico(codice, punti);
    partita.aggiungiGiocatore(socket.id, nome);

    stanze.set(codice, partita);
    socket.join(codice);
    socket.codiceStanza = codice;
    socket.nomeGiocatore = nome;

    socket.emit('stanzaCreata', { codice, nome });
    console.log(`Stanza ${codice} creata da ${nome}`);
  });

  // Unisciti a stanza esistente
  socket.on('uniscitiStanza', ({ codice, nome }) => {
    const partita = stanze.get(codice);

    if (!partita) {
      socket.emit('errore', 'Stanza non trovata');
      return;
    }

    if (partita.giocatori.length >= 2) {
      socket.emit('errore', 'Stanza piena');
      return;
    }

    partita.aggiungiGiocatore(socket.id, nome);
    socket.join(codice);
    socket.codiceStanza = codice;
    socket.nomeGiocatore = nome;

    socket.emit('unitoAStanza', { codice, nome });

    // Notifica entrambi i giocatori
    io.to(codice).emit('giocatoreUnito', {
      giocatori: partita.giocatori.map(g => ({ id: g.id, nome: g.nome }))
    });

    // Inizia la partita
    if (partita.giocatori.length === 2) {
      partita.iniziaPartita();

      for (const g of partita.giocatori) {
        io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
      }

      console.log(`Partita iniziata nella stanza ${codice}`);
    }
  });

  // Gioca carta
  socket.on('giocaCarta', ({ cartaId, cartePresaIds }) => {
    const codice = socket.codiceStanza;
    const partita = stanze.get(codice);

    if (!partita) {
      socket.emit('errore', 'Partita non trovata');
      return;
    }

    const giocatore = partita.giocatori.find(g => g.id === socket.id);
    const cartaGiocata = giocatore?.mano.find(c => c.id === cartaId);
    const cartaInfo = cartaGiocata ? {
      valore: cartaGiocata.valore,
      seme: cartaGiocata.seme,
      id: cartaGiocata.id
    } : null;

    const risultato = partita.eseguiMossa(socket.id, cartaId, cartePresaIds || []);

    if (!risultato.valida) {
      socket.emit('mossaNonValida', risultato.errore);
      return;
    }

    if (partita.stato === 'fineRound' || partita.stato === 'finePartita') {
      const puntiRound = partita.calcolaPuntiRound();
      const dettagliPunti = partita.calcolaPuntiRoundDettagliato();

      for (const g of partita.giocatori) {
        const stato = partita.getStato(g.id);
        const avversario = partita.giocatori.find(p => p.id !== g.id);
        io.to(g.id).emit('fineRound', {
          stato,
          puntiRound,
          dettagliGiocatore: dettagliPunti[g.id],
          dettagliAvversario: dettagliPunti[avversario.id],
          finePartita: partita.stato === 'finePartita',
          vincitore: partita.stato === 'finePartita' ?
            partita.giocatori.find(p => p.puntiTotali >= partita.puntiVittoria)?.nome : null,
          cartaGiocata: cartaInfo,
          giocatoreId: socket.id
        });
      }
    } else {
      for (const g of partita.giocatori) {
        io.to(g.id).emit('statoAggiornato', {
          ...partita.getStato(g.id),
          cartaGiocata: cartaInfo,
          giocatoreId: socket.id
        });
      }
    }
  });

  // Richiedi combinazioni possibili
  socket.on('richiediCombinazioni', (cartaId) => {
    const codice = socket.codiceStanza;
    const partita = stanze.get(codice);

    if (!partita) return;

    const giocatore = partita.giocatori.find(g => g.id === socket.id);
    if (!giocatore) return;

    const carta = giocatore.mano.find(c => c.id === cartaId);
    if (!carta) return;

    const combinazioni = partita.trovaCombinazioni(carta, partita.tavolo);

    socket.emit('combinazioniDisponibili', {
      cartaId,
      combinazioni: combinazioni.map(comb => comb.map(c => c.id)),
      puoiPosare: combinazioni.length === 0
    });
  });

  // Nuovo round
  socket.on('nuovoRound', () => {
    const codice = socket.codiceStanza;
    const partita = stanze.get(codice);

    if (!partita || partita.stato !== 'fineRound') return;

    partita.nuovoRound();

    for (const g of partita.giocatori) {
      io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
    }
  });

  // Nuova partita
  socket.on('nuovaPartita', () => {
    const codice = socket.codiceStanza;
    const partita = stanze.get(codice);

    if (!partita) return;

    for (const g of partita.giocatori) {
      g.puntiTotali = 0;
    }

    partita.iniziaPartita();

    for (const g of partita.giocatori) {
      io.to(g.id).emit('partitaIniziata', partita.getStato(g.id));
    }
  });

  // Disconnessione
  socket.on('disconnect', () => {
    console.log(`Giocatore disconnesso: ${socket.id}`);

    const codice = socket.codiceStanza;
    if (!codice) return;

    const partita = stanze.get(codice);
    if (!partita) return;

    partita.rimuoviGiocatore(socket.id);

    io.to(codice).emit('avversarioDisconnesso');

    if (partita.giocatori.length === 0) {
      stanze.delete(codice);
      console.log(`Stanza ${codice} eliminata`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server Scopone Scientifico in esecuzione su http://localhost:${PORT}`);
});
