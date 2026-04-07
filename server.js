const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { ScoponeScientifico } = require('./game-logic');
const db = require('./db');
const torneo = require('./tournament');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API Auth ---
app.post('/api/registra', (req, res) => { res.json(db.registra(req.body.nome, req.body.email, req.body.password)); });
app.post('/api/login', (req, res) => { res.json(db.login(req.body.nome, req.body.password)); });
app.get('/api/stats/:nome', (req, res) => { const s = db.getStats(req.params.nome); res.json(s ? { ok: true, stats: s } : { ok: false }); });
app.get('/api/classifica', (req, res) => { res.json({ ok: true, classifica: db.getClassifica() }); });
app.get('/api/isadmin/:nome', (req, res) => { res.json({ ok: true, admin: db.isAdmin(req.params.nome) }); });
app.post('/api/cambiapassword', (req, res) => { res.json(db.cambiaPassword(req.body.nome, req.body.nuovaPassword)); });
app.post('/api/eliminaaccount', (req, res) => { res.json(db.cancellaUtente(req.body.nome)); });

// --- API Amici ---
app.get('/api/amici/:nome', (req, res) => { res.json({ ok: true, amici: db.getAmici(req.params.nome), richieste: db.getRichiesteAmicizia(req.params.nome) }); });
app.post('/api/amici/richiedi', (req, res) => { const r = db.richiediAmicizia(req.body.utente, req.body.amico); if (r.ok) for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === req.body.amico) io.to(s.id).emit('richiestaAmicizia', { da: req.body.utente }); res.json(r); });
app.post('/api/amici/accetta', (req, res) => { const r = db.accettaAmicizia(req.body.utente, req.body.amico); if (r.ok) for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === req.body.amico) io.to(s.id).emit('amiciziaAccettata', { da: req.body.utente }); res.json(r); });
app.post('/api/amici/rifiuta', (req, res) => { res.json(db.rifiutaAmicizia(req.body.utente, req.body.amico)); });
app.post('/api/amici/rimuovi', (req, res) => { res.json(db.rimuoviAmico(req.body.utente, req.body.amico)); });
app.get('/api/amici/:nome/online', (req, res) => {
  const amici = db.getAmici(req.params.nome).map(a => a.nome); const online = {};
  for (const a of amici) { online[a] = { online: false, stanza: null }; for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === a) { online[a] = { online: true, stanza: s.codiceStanza || null }; break; } }
  res.json({ ok: true, online });
});

// --- API Torneo ---
app.get('/api/torneo/attivo', (req, res) => { const t = torneo.getTorneoAttivo(); if (!t) return res.json({ ok: true, torneo: null }); res.json({ ok: true, torneo: t.stato === 'iscrizioni' ? torneo.getIscrizioni(t.id) : torneo.getTabellone(t.id) }); });
app.get('/api/torneo/:id/tabellone', (req, res) => { const t = torneo.getTabellone(parseInt(req.params.id)); res.json(t ? { ok: true, torneo: t } : { ok: false }); });
app.post('/api/torneo/iscriviti', (req, res) => {
  const { torneoId, nome, numeroSquadra } = req.body;
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  const r = torneo.iscriviGiocatore(torneoId, nome, ip, numeroSquadra);
  if (r.ok && r.torneoIniziato) { io.emit('torneoIniziato', { torneoId }); avviaPartitePronteTorneo(torneoId); }
  else if (r.ok) io.emit('torneoAggiornato', { torneoId });
  res.json(r);
});
app.post('/api/torneo/lascia', (req, res) => { const r = torneo.rimuoviIscrizione(req.body.torneoId, req.body.nome); if (r.ok) io.emit('torneoAggiornato', { torneoId: req.body.torneoId }); res.json(r); });

// --- API Admin ---
app.post('/api/admin/resetpassword', (req, res) => { if (!db.isAdmin(req.body.admin)) return res.status(403).json({ ok: false }); res.json(db.resetPassword(req.body.nome)); });
app.post('/api/admin/cancellautente', (req, res) => { if (!db.isAdmin(req.body.admin)) return res.status(403).json({ ok: false }); res.json(db.cancellaUtente(req.body.nome)); });
app.get('/api/admin/utenti', (req, res) => { if (!db.isAdmin(req.query.nome)) return res.status(403).json({ ok: false }); res.json({ ok: true, utenti: db.getTuttiUtenti() }); });
app.get('/api/admin/online', (req, res) => {
  if (!db.isAdmin(req.query.nome)) return res.status(403).json({ ok: false });
  const utentiOnline = []; for (const [, s] of io.sockets.sockets) { if (s.nomeGiocatore) utentiOnline.push({ nome: s.nomeGiocatore, stanza: s.codiceStanza || null, ip: s.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || s.handshake.address }); }
  const infoStanze = []; for (const [codice, p] of stanze) { infoStanze.push({ codice, stato: p.stato, giocatori: p.giocatori.map(g => ({ nome: g.nome, disconnesso: g.disconnesso || false })) }); }
  res.json({ ok: true, utentiOnline, stanze: infoStanze });
});
app.post('/api/admin/torneo/crea', (req, res) => { if (!db.isAdmin(req.body.admin)) return res.status(403).json({ ok: false }); const r = torneo.creaTorneo(req.body.nome, req.body.numGiocatori, req.body.modalitaVittoria || 'punti', req.body.valoreVittoria || 21, req.body.controlloIp !== false); if (r.ok) io.emit('torneoDisponibile', { torneoId: r.torneoId }); res.json(r); });
app.post('/api/admin/torneo/annulla', (req, res) => { if (!db.isAdmin(req.body.admin)) return res.status(403).json({ ok: false }); const r = torneo.annullaTorneo(req.body.torneoId); if (r.ok) io.emit('torneoAnnullato', { torneoId: req.body.torneoId }); res.json(r); });
app.post('/api/admin/torneo/assegna', (req, res) => { if (!db.isAdmin(req.body.admin)) return res.status(403).json({ ok: false }); const r = torneo.iscriviGiocatoreInSquadra(req.body.torneoId, req.body.nomeUtente, req.body.numeroSquadra, null); if (r.ok && r.torneoIniziato) { io.emit('torneoIniziato', { torneoId: req.body.torneoId }); avviaPartitePronteTorneo(req.body.torneoId); } else if (r.ok) io.emit('torneoAggiornato', { torneoId: req.body.torneoId }); res.json(r); });
app.post('/api/admin/torneo/sposta', (req, res) => { if (!db.isAdmin(req.body.admin)) return res.status(403).json({ ok: false }); const r = torneo.spostaGiocatore(req.body.torneoId, req.body.nomeUtente, req.body.numeroSquadra); if (r.ok) io.emit('torneoAggiornato', { torneoId: req.body.torneoId }); res.json(r); });

function creaStanzaTorneo(torneoId, round, posizione) {
  const tab = torneo.getTabellone(torneoId); if (!tab) return;
  const rd = tab.rounds.find(r => r.chiave === round); if (!rd) return;
  const pd = rd.partite.find(p => p.posizione === posizione); if (!pd || !pd.squadraA || !pd.squadraB || pd.stato !== 'attesa') return;
  const codice = 'T' + generaCodiceStanza().slice(1);
  const partita = new ScoponeScientifico(codice, tab.valoreVittoria);
  stanze.set(codice, partita);
  torneo.setCodiceStanza(torneoId, round, posizione, codice);
  const tutti = [...pd.squadraA.giocatori, ...pd.squadraB.giocatori];
  for (const [, s] of io.sockets.sockets) { if (s.nomeGiocatore && tutti.includes(s.nomeGiocatore)) io.to(s.id).emit('torneoPartitaPronta', { torneoId, codiceStanza: codice, round, posizione, squadraA: pd.squadraA, squadraB: pd.squadraB }); }
}
function avviaPartitePronteTorneo(torneoId) { for (const p of torneo.getPartitePronte(torneoId)) creaStanzaTorneo(torneoId, p.round, p.posizione); }

// Stanze di gioco
const stanze = new Map();
const disconnessioniPendenti = new Map();
const chatLobbyMessaggi = [];

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

  socket.on('autenticato', ({ nome }) => { if (nome) socket.nomeGiocatore = nome; });

  socket.on('chatLobbyMessaggio', ({ testo }) => {
    if (!socket.nomeGiocatore || !testo || !testo.trim()) return;
    const msg = { nome: socket.nomeGiocatore, testo: testo.trim().slice(0, 200), timestamp: Date.now() };
    chatLobbyMessaggi.push(msg); if (chatLobbyMessaggi.length > 50) chatLobbyMessaggi.shift();
    for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore && !s.codiceStanza) io.to(s.id).emit('chatLobbyMessaggio', msg);
  });
  socket.on('chatLobbyStoria', () => socket.emit('chatLobbyStoria', chatLobbyMessaggi));

  socket.on('invitaAmico', ({ amico, codiceStanza }) => {
    if (!socket.nomeGiocatore || !amico || !codiceStanza) return;
    for (const [, s] of io.sockets.sockets) if (s.nomeGiocatore === amico) io.to(s.id).emit('invitoStanza', { da: socket.nomeGiocatore, codiceStanza });
  });

  socket.on('uniscitiPartitaTorneo', ({ codiceStanza, nome }) => {
    const partita = stanze.get(codiceStanza);
    if (!partita) { socket.emit('errore', 'Stanza torneo non trovata'); return; }
    const esis = partita.giocatori.find(g => g.nome === nome);
    if (esis) { esis.id = socket.id; esis.disconnesso = false; socket.join(codiceStanza); socket.codiceStanza = codiceStanza; socket.nomeGiocatore = nome; if (partita.stato !== 'attesa') socket.emit('partitaIniziata', partita.getStato(socket.id)); return; }
    if (partita.giocatori.length >= 2) { socket.emit('errore', 'Stanza piena'); return; }
    partita.aggiungiGiocatore(socket.id, nome);
    socket.join(codiceStanza); socket.codiceStanza = codiceStanza; socket.nomeGiocatore = nome;
    io.to(codiceStanza).emit('giocatoreUnito', { giocatori: partita.giocatori.map(g => ({ id: g.id, nome: g.nome })) });
    if (partita.giocatori.length === 2) { partita.iniziaPartita(); for (const g of partita.giocatori) io.to(g.id).emit('partitaIniziata', partita.getStato(g.id)); }
  });

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

    // Controlla se è una riconnessione (giocatore con stesso nome, disconnesso o meno)
    const chiaveDisc = `${codice}_${nome}`;
    const giocatoreEsistente = partita.giocatori.find(g => g.nome === nome);

    if (giocatoreEsistente && (partita.stato === 'inCorso' || partita.stato === 'fineRound' || partita.stato === 'finePartita')) {
      const vecchioSocket = io.sockets.sockets.get(giocatoreEsistente.id);
      if (vecchioSocket) {
        vecchioSocket.codiceStanza = null;
        vecchioSocket.disconnect(true);
      }

      giocatoreEsistente.id = socket.id;
      giocatoreEsistente.disconnesso = false;

      if (disconnessioniPendenti.has(chiaveDisc)) {
        clearTimeout(disconnessioniPendenti.get(chiaveDisc));
        disconnessioniPendenti.delete(chiaveDisc);
      }

      socket.join(codice);
      socket.codiceStanza = codice;
      socket.nomeGiocatore = nome;

      socket.emit('partitaIniziata', partita.getStato(socket.id));
      io.to(codice).emit('giocatoreRiconnesso', { nome });
      console.log(`Giocatore ${nome} riconnesso nella stanza ${codice}`);
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
      const finePartita = partita.stato === 'finePartita';
      const vincitoreNome = finePartita ? partita.giocatori.find(p => p.puntiTotali >= partita.puntiVittoria)?.nome : null;

      if (finePartita && !partita._statsAggiornate) {
        partita._statsAggiornate = true;
        for (const g of partita.giocatori) {
          if (g.nome === vincitoreNome) db.aggiornaStats(g.nome, { giocate: 1, vinte: 1, punti: 1 });
          else db.aggiornaStats(g.nome, { giocate: 1, perse: 1, punti: -1 });
        }
        const codice = socket.codiceStanza;
        const pt = torneo.getPartitaDaCodice(codice);
        if (pt) {
          const vincitoreG = partita.giocatori.find(g => g.nome === vincitoreNome);
          const vincitoreIdx = partita.giocatori.indexOf(vincitoreG);
          const vincitoreId = vincitoreIdx === 0 ? pt.squadra_a : pt.squadra_b;
          const ris = torneo.registraRisultato(pt.torneo_id, pt.round, pt.posizione, vincitoreId, 0, 0);
          if (ris.completato) io.emit('torneoCompletato', { torneoId: pt.torneo_id });
          else { io.emit('torneoAggiornato', { torneoId: pt.torneo_id }); if (ris.prossimaPartitaPronta) creaStanzaTorneo(pt.torneo_id, ris.round, ris.posizione); }
        }
      }

      for (const g of partita.giocatori) {
        const stato = partita.getStato(g.id);
        const avversario = partita.giocatori.find(p => p.id !== g.id);
        const codice = socket.codiceStanza;
        const pt = finePartita ? torneo.getPartitaDaCodice(codice) : null;
        io.to(g.id).emit('fineRound', {
          stato, puntiRound,
          dettagliGiocatore: dettagliPunti[g.id],
          dettagliAvversario: dettagliPunti[avversario.id],
          finePartita, vincitore: vincitoreNome,
          cartaGiocata: cartaInfo, giocatoreId: socket.id,
          torneo: pt ? { torneoId: pt.torneo_id, round: pt.round, finale: pt.round === 'finale' } : null
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

  // Torna alla lobby (solo se partita finita)
  socket.on('tornaLobby', () => {
    const codice = socket.codiceStanza;
    if (!codice) return;
    const partita = stanze.get(codice);
    if (!partita) return;
    if (partita.stato !== 'finePartita') return;
    const giocatore = partita.giocatori.find(g => g.id === socket.id);
    if (!giocatore) return;
    partita.rimuoviGiocatore(socket.id);
    socket.leave(codice);
    socket.codiceStanza = null;
    io.to(codice).emit('avversarioAbbandonato', { nome: giocatore.nome });
    if (partita.giocatori.length === 0) {
      stanze.delete(codice);
      console.log(`Stanza ${codice} eliminata`);
    }
  });

  // Disconnessione
  socket.on('disconnect', () => {
    console.log(`Giocatore disconnesso: ${socket.id}`);

    const codice = socket.codiceStanza;
    if (!codice) return;

    const partita = stanze.get(codice);
    if (!partita) return;

    const giocatore = partita.giocatori.find(g => g.id === socket.id);
    if (!giocatore) return;

    if (partita.stato === 'inCorso' || partita.stato === 'fineRound') {
      giocatore.disconnesso = true;
      const nome = giocatore.nome;
      const chiaveDisc = `${codice}_${nome}`;

      io.to(codice).emit('avversarioDisconnesso', { nome, timeout: 180 });
      console.log(`Giocatore ${nome} disconnesso dalla stanza ${codice}, attendo riconnessione...`);

      const timer = setTimeout(() => {
        disconnessioniPendenti.delete(chiaveDisc);
        db.aggiornaStats(nome, { giocate: 1, perse: 1, punti: -1 });
        for (const g of partita.giocatori) { if (g.nome !== nome) db.aggiornaStats(g.nome, { giocate: 1, vinte: 1, punti: 1 }); }
        const pt = torneo.getPartitaDaCodice(codice);
        if (pt) {
          const avv = partita.giocatori.find(g => g.nome !== nome);
          const vincitoreId = avv ? (partita.giocatori.indexOf(avv) === 0 ? pt.squadra_a : pt.squadra_b) : pt.squadra_b;
          const ris = torneo.registraRisultato(pt.torneo_id, pt.round, pt.posizione, vincitoreId, 0, 0);
          if (ris.completato) io.emit('torneoCompletato', { torneoId: pt.torneo_id });
          else { io.emit('torneoAggiornato', { torneoId: pt.torneo_id }); if (ris.prossimaPartitaPronta) creaStanzaTorneo(pt.torneo_id, ris.round, ris.posizione); }
        }
        partita.rimuoviGiocatore(giocatore.id);
        io.to(codice).emit('avversarioAbbandonato', { nome });
        console.log(`Giocatore ${nome} rimosso dalla stanza ${codice} (timeout)`);

        if (partita.giocatori.filter(g => !g.disconnesso).length === 0) {
          stanze.delete(codice);
          console.log(`Stanza ${codice} eliminata`);
        }
      }, 180000);

      disconnessioniPendenti.set(chiaveDisc, timer);
    } else {
      partita.rimuoviGiocatore(socket.id);
      io.to(codice).emit('avversarioAbbandonato', { nome: giocatore.nome });

      if (partita.giocatori.length === 0) {
        stanze.delete(codice);
        console.log(`Stanza ${codice} eliminata`);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server Scopone Scientifico in esecuzione su http://localhost:${PORT}`);
  const ta = torneo.getTorneoAttivo();
  if (ta && ta.stato === 'inCorso') { torneo.resetPartiteInCorso(ta.id); avviaPartitePronteTorneo(ta.id); console.log(`Torneo "${ta.nome}" ripristinato`); }
});
