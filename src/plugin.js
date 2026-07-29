/// <reference types="@zyllio/zy-sdk" />

// ============================================================================
// SECTION 1 : ACTION & MÉTADONNÉES ZYLLIO
// ============================================================================
(function () {
  console.log('Plugin Clean MIDI (Action V2) chargé');

  class CleanMidiAction {
    async execute() {
      if (!this.fileUrl) {
        console.warn('CleanMidiAction: fileUrl manquant');
        return null;
      }

      // Import dynamique de la bibliothèque de parsing/écriture MIDI
      const { parseMidi, writeMidi } = await import('https://esm.sh/midi-file');

      // Téléchargement du fichier d'origine
      const response = await fetch(this.fileUrl);
      if (!response.ok) {
        throw new Error(`Échec du téléchargement du fichier MIDI: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const inputMidi = parseMidi(new Uint8Array(arrayBuffer));

      // Exécution de la logique métier pure (Section 2)
      const options = {
        keepCc: this.keepCc === true || this.keepCc === 'true',
        removeLeadVocals: this.removeLeadVocals === true || this.removeLeadVocals === 'true',
        drawTrackLabels: this.drawTrackLabels === true || this.drawTrackLabels === 'true',
        fixOverlaps: this.fixOverlaps !== false && this.fixOverlaps !== 'false'
      };

      const outputMidi = window.cleanMidi(inputMidi, options);
      const outputBytes = writeMidi(outputMidi);

      // Enregistrement et hébergement du fichier nettoyé
      const file = new File(
        [new Uint8Array(outputBytes)],
        "cleaned.mid", {
        type: "audio/midi",
        lastModified: Date.now()
      });

      this.value = await this.storageService.uploadFile(file, true);
      return 'complete';
    }
  }

  const IconData = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#cccccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 18V5l12-2v13"></path>
      <circle cx="6" cy="18" r="3"></circle>
      <circle cx="18" cy="16" r="3"></circle>
    </svg>
  `;

  const CleanMidiMetadata = {
    metadataVersion: 2,
    id: 'documents-clean-midi',
    icon: IconData,
    label: 'Nettoyer fichier MIDI',
    category: 'Documents',
    transitions: ['complete'],
    properties: [{
      id: 'value',
      name: 'URL MIDI Nettoyé',
      type: 'text',
      default: '',
      main: true,
      write: true
    }, {
      id: 'file-url',
      name: 'URL MIDI D\'origine',
      type: 'text',
      default: '',
    }, {
      id: 'keep-cc',
      name: 'Conserver les CC',
      type: 'boolean',
      default: false
    }, {
      id: 'remove-lead-vocals',
      name: 'Retirer le chant principal',
      type: 'boolean',
      default: false
    }, {
      id: 'draw-track-labels',
      name: 'Dessiner les noms de pistes',
      type: 'boolean',
      default: false
    }, {
      id: 'fix-overlaps',
      name: 'Résoudre les chevauchements',
      type: 'boolean',
      default: true
    }],
    translations: [{
      lang: 'en',
      label: 'Clean MIDI file',
      category: 'Documents',
      properties: [
        { id: 'value', name: 'Cleaned MIDI URL' },
        { id: 'file-url', name: 'Original MIDI URL' },
        { id: 'keep-cc', name: 'Keep Control Changes' },
        { id: 'remove-lead-vocals', name: 'Remove Lead Vocals' },
        { id: 'draw-track-labels', name: 'Draw Track Labels' },
        { id: 'fix-overlaps', name: 'Resolve Overlaps' }
      ]
    }]
  };

  // Enregistrement de l'action dans le SDK Zyllio
  zySdk.services.registry.registerAction(CleanMidiMetadata, CleanMidiAction);
})();

// ============================================================================
// SECTION 2 : LOGIQUE MÉTIER PURE (IIFE - EXPOSÉE SUR WINDOW)
// ============================================================================
(function (global) {
  const TARGET_TICKS_PER_BEAT = 960;
  const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];
  const LABEL_TOP_NOTE = 127;
  const LABEL_PIXEL_TICKS = 180;
  const LABEL_STEP_TICKS = 240;
  const LABEL_VELOCITY = 1;
  const LABEL_MAX_LENGTH = 5;
  const TRACK_LABEL_RULES = [
    { label: "DRM", match: /\b(drums?|drumkit|percussion|perc|batterie|bateria|kick|snare|tom|cymbal|charley|hi[- ]?hat|hihat)\b/i },
    { label: "VOX", match: /\b(lead vocals?|chant|voix|vocal lead)\b/i, exclude: /\b(backing vocals?|choirs?|choeur|choeurs|chorus|aahs?|oohs?)\b/i },
    { label: "BKVOX", match: /\b(backing vocals?)\b/i },
    { label: "CHOIR", match: /\b(choirs?|choeur|choeurs|chorus|aahs?|oohs?)\b/i },
    { label: "BASS", match: /\b(bass|basse)\b/i },
    { label: "CBASS", match: /\b(contrabass|contrebase)\b/i },
    { label: "GTR", match: /\b(guitar|guitare|les paul)\b/i },
    { label: "PNO", match: /\b(piano)\b/i },
    { label: "VIOL", match: /\b(violin)\b/i },
    { label: "VLA", match: /\b(viola)\b/i },
    { label: "CELLO", match: /\b(cello)\b/i },
    { label: "PIZZ", match: /\b(pizzicato)\b/i },
    { label: "STR", match: /\b(strings?|string ensemble)\b/i },
    { label: "ORCH", match: /\b(orchestra|orchestre)\b/i },
    { label: "BRASS", match: /\b(brass)\b/i },
    { label: "SYN", match: /\b(synth)\b/i },
    { label: "PAD", match: /\b(pad)\b/i }
  ];
  const LABEL_FONT = {
    "A": ["111", "101", "111", "101", "101"],
    "B": ["110", "101", "110", "101", "110"],
    "C": ["111", "100", "100", "100", "111"],
    "D": ["110", "101", "101", "101", "110"],
    "E": ["111", "100", "110", "100", "111"],
    "F": ["111", "100", "110", "100", "100"],
    "G": ["111", "100", "101", "101", "111"],
    "H": ["101", "101", "111", "101", "101"],
    "I": ["111", "010", "010", "010", "111"],
    "J": ["001", "001", "001", "101", "111"],
    "K": ["101", "101", "110", "101", "101"],
    "L": ["100", "100", "100", "100", "111"],
    "M": ["101", "111", "111", "101", "101"],
    "N": ["101", "111", "111", "111", "101"],
    "O": ["111", "101", "101", "101", "111"],
    "P": ["111", "101", "111", "100", "100"],
    "Q": ["111", "101", "101", "111", "001"],
    "R": ["110", "101", "110", "101", "101"],
    "S": ["111", "100", "111", "001", "111"],
    "T": ["111", "010", "010", "010", "010"],
    "U": ["101", "101", "101", "101", "111"],
    "V": ["101", "101", "101", "101", "010"],
    "W": ["101", "101", "111", "111", "101"],
    "X": ["101", "101", "010", "101", "101"],
    "Y": ["101", "101", "010", "010", "010"],
    "Z": ["111", "001", "010", "100", "111"],
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"]
  };

  // Helpers de manipulation d'événements
  const toAbsoluteEvents = (track) => {
    let absoluteTime = 0;
    return track.map((event, sourceOrder) => {
      absoluteTime += event.deltaTime || 0;
      return { ...event, absoluteTime, sourceOrder };
    });
  };

  const withoutRuntimeFields = (event) => {
    const cleanEvent = { ...event };
    delete cleanEvent.absoluteTime;
    delete cleanEvent.deltaTime;
    delete cleanEvent.sourceOrder;
    return cleanEvent;
  };

  const isPlayableNoteOn = (event) => event.type === "noteOn" && event.velocity > 0;
  const isNoteEnd = (event) => event.type === "noteOff" || (event.type === "noteOn" && event.velocity === 0);
  const isNoteEvent = (event) => isPlayableNoteOn(event) || isNoteEnd(event);
  const isTimingEvent = (event) => event.type === "setTempo" || event.type === "timeSignature";
  const getPitchBendValue = (event) => event.value === undefined ? 0 : event.value;

  const getTimingEventKey = (event) => JSON.stringify({
    type: event.type,
    absoluteTime: event.absoluteTime,
    microsecondsPerBeat: event.microsecondsPerBeat,
    numerator: event.numerator,
    denominator: event.denominator,
    metronome: event.metronome,
    thirtyseconds: event.thirtyseconds
  });

  const getEventPriority = (event) => {
    if (isTimingEvent(event)) return 0;
    if (isNoteEnd(event)) return 1;
    if (isPlayableNoteOn(event)) return 2;
    return 3;
  };

  const compareEvents = (a, b) => {
    if (a.absoluteTime !== b.absoluteTime) return a.absoluteTime - b.absoluteTime;
    const diff = getEventPriority(a) - getEventPriority(b);
    return diff !== 0 ? diff : (a.sourceOrder || 0) - (b.sourceOrder || 0);
  };

  const scaleTick = (tick, src, dst) => Math.round(tick * dst / src);
  const getTrackEndTime = (events) => events.reduce((max, e) => Math.max(max, e.absoluteTime), 0);
  
  const getTrackText = (track) => track
    .filter(e => e.type === "trackName" || e.type === "instrumentName" || e.type === "text")
    .map(e => e.text).filter(Boolean).join(" ");

  const isPercussionTrack = (track, absoluteEvents) => {
    const text = getTrackText(track);
    const isPercName = /\b(drums?|drumkit|percussion|perc|batterie|bateria|kick|snare|tom|cymbal|charley|hi[- ]?hat|hihat)\b/i.test(text);
    return isPercName || absoluteEvents.some(e => isPlayableNoteOn(e) && e.channel === 9);
  };

  const isChoirTrackText = (text) =>
    /\b(backing vocals?|choirs?|choeur|choeurs|chorus|aahs?|oohs?)\b/i.test(text);

  const isLeadVocalTrack = (track) => {
    const text = getTrackText(track);
    const isLeadVocalName = /\b(lead vocals?|chant|voix|vocal lead)\b/i.test(text);
    return isLeadVocalName && !isChoirTrackText(text);
  };

  const getTrackLabel = (track, isPercussion) => {
    const text = getTrackText(track);
    if (isPercussion) return "DRM";

    const rule = TRACK_LABEL_RULES.find((candidate) =>
      candidate.match.test(text) &&
      (!candidate.exclude || !candidate.exclude.test(text))
    );
    if (rule) return rule.label;

    return text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, LABEL_MAX_LENGTH) || "TRK";
  };

  const buildLabelEvents = (label, channel) => {
    const events = [];
    let columnOffset = 0;
    label.toUpperCase().slice(0, LABEL_MAX_LENGTH).split("").forEach((char) => {
      const glyph = LABEL_FONT[char];
      if (!glyph) {
        columnOffset += 2;
        return;
      }

      glyph.forEach((row, rowIndex) => {
        row.split("").forEach((pixel, columnIndex) => {
          if (pixel !== "1") return;
          const absoluteTime = (columnOffset + columnIndex) * LABEL_STEP_TICKS;
          const noteNumber = LABEL_TOP_NOTE - rowIndex;
          events.push(
            { absoluteTime, sourceOrder: -1000, type: "noteOn", channel, noteNumber, velocity: LABEL_VELOCITY },
            { absoluteTime: absoluteTime + LABEL_PIXEL_TICKS, sourceOrder: -999, type: "noteOff", channel, noteNumber, velocity: 0 }
          );
        });
      });

      columnOffset += 4;
    });
    return events;
  };

  /**
   * Fonction logique pure de nettoyage MIDI. Exclut toute référence spécifique à Zyllio.
   */
  function cleanMidi(inputMidi, options = {}) {
    const sourceTicksPerBeat = inputMidi.header.ticksPerBeat;
    
    const keepCc = !!options.keepCc;
    const removeLeadVocals = !!options.removeLeadVocals;
    const drawTrackLabels = !!options.drawTrackLabels;
    const fixOverlaps = options.fixOverlaps !== false;

    // 1. Classification & allocation des canaux
    const trackInfos = inputMidi.tracks.map((track, index) => {
      const events = toAbsoluteEvents(track);
      const notesCount = events.filter(isPlayableNoteOn).length;
      const shouldRemoveTrack = removeLeadVocals && isLeadVocalTrack(track);
      const isInstrument = notesCount > 0 && !shouldRemoveTrack;
      return {
        index,
        track,
        events,
        isInstrument,
        shouldRemoveTrack,
        isPercussion: isInstrument && isPercussionTrack(track, events),
        endTime: getTrackEndTime(events),
        destinationChannel: null
      };
    });

    let melodicIndex = 0;
    trackInfos.forEach((t) => {
      if (!t.isInstrument) return;
      t.destinationChannel = t.isPercussion ? 9 : MELODIC_CHANNELS[melodicIndex++ % MELODIC_CHANNELS.length];
    });

    // 2. Consolidation des tempos / rythmes
    const seenTimings = new Set();
    const timingEvents = [];
    trackInfos.forEach((t) => {
      t.events.filter(isTimingEvent).forEach((event) => {
        const key = getTimingEventKey(event);
        if (seenTimings.has(key)) return;
        seenTimings.add(key);
        timingEvents.push({
          ...withoutRuntimeFields(event),
          absoluteTime: scaleTick(event.absoluteTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT),
          sourceOrder: event.sourceOrder
        });
      });
    });

    // 3. Normalisation des pistes
    const outputEventsByTrack = trackInfos.map((t) => {
      if (!t.isInstrument) return [];

      const activeNotes = new Map();
      const notes = [];
      
      t.events.filter(isNoteEvent).sort(compareEvents).forEach((event) => {
        const noteKey = `${event.channel}:${event.noteNumber}`;
        const stack = activeNotes.get(noteKey) || [];

        if (isPlayableNoteOn(event)) {
          stack.push(event);
          activeNotes.set(noteKey, stack);
          return;
        }

        if (stack.length === 0) return;
        const startEvent = stack.shift();
        const startTime = scaleTick(startEvent.absoluteTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT);
        const endTime = Math.max(scaleTick(event.absoluteTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT), startTime + 1);

        notes.push({
          start: startTime,
          end: endTime,
          channel: t.destinationChannel,
          noteNumber: startEvent.noteNumber,
          velocity: startEvent.velocity,
          startOrder: startEvent.sourceOrder,
          endOrder: event.sourceOrder
        });
      });

      // Gestion des notes suspendues
      activeNotes.forEach((stack) => {
        stack.forEach((startEvent) => {
          const startTime = scaleTick(startEvent.absoluteTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT);
          notes.push({
            start: startTime,
            end: Math.max(scaleTick(t.endTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT), startTime + 1),
            channel: t.destinationChannel,
            noteNumber: startEvent.noteNumber,
            velocity: startEvent.velocity,
            startOrder: startEvent.sourceOrder,
            endOrder: startEvent.sourceOrder
          });
        });
      });

      let finalNotes = notes;

      // Résolution des chevauchements
      if (fixOverlaps) {
        const groups = new Map();
        finalNotes.forEach((n) => {
          const key = `${n.channel}:${n.noteNumber}`;
          const group = groups.get(key) || [];
          group.push(n);
          groups.set(key, group);
        });

        const toRemove = new Set();
        groups.forEach((group) => {
          group.sort((a, b) => a.start - b.start || a.end - b.end);
          for (let i = 0; i < group.length - 1; i++) {
            const note = group[i];
            const nextNote = group[i + 1];
            if (note.end < nextNote.start) continue;
            
            const adjusted = nextNote.start - 1;
            if (adjusted <= note.start) toRemove.add(note);
            else note.end = adjusted;
          }
        });
        finalNotes = finalNotes.filter((n) => !toRemove.has(n));
      }

      // Construction des événements de note finaux
      const trackEvents = finalNotes.flatMap((n) => [
        { absoluteTime: n.start, sourceOrder: n.startOrder, type: "noteOn", channel: n.channel, noteNumber: n.noteNumber, velocity: n.velocity },
        { absoluteTime: n.end, sourceOrder: n.endOrder, type: "noteOff", channel: n.channel, noteNumber: n.noteNumber, velocity: 0 }
      ]);

      if (drawTrackLabels) {
        trackEvents.push(...buildLabelEvents(getTrackLabel(t.track, t.isPercussion), t.destinationChannel));
      }

      // Métadonnées additionnelles
      const optional = [];
      const pitchBendByChannel = new Map();
      t.events.forEach((event) => {
        if (keepCc && event.type === "controller") {
          optional.push({
            ...withoutRuntimeFields(event),
            absoluteTime: scaleTick(event.absoluteTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT),
            sourceOrder: event.sourceOrder,
            channel: t.destinationChannel
          });
        } else if (event.type === "pitchBend") {
          const value = getPitchBendValue(event);
          const previousValue = pitchBendByChannel.has(t.destinationChannel) ? pitchBendByChannel.get(t.destinationChannel) : 0;
          if (value === previousValue) return;

          pitchBendByChannel.set(t.destinationChannel, value);
          optional.push({
            ...withoutRuntimeFields(event),
            absoluteTime: scaleTick(event.absoluteTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT),
            sourceOrder: event.sourceOrder,
            channel: t.destinationChannel
          });
        } else if (event.type === "trackName" || event.type === "instrumentName" || event.type === "text") {
          optional.push({
            ...withoutRuntimeFields(event),
            absoluteTime: scaleTick(event.absoluteTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT),
            sourceOrder: event.sourceOrder
          });
        }
      });

      if (optional.length > 0) trackEvents.push(...optional);
      return trackEvents;
    });

    // Injection des tempos sur la première piste non vide
    if (outputEventsByTrack.length > 0) {
      let targetTrackIdx = 0;
      for (let i = 0; i < outputEventsByTrack.length; i++) {
        if (outputEventsByTrack[i].length > 0) {
          targetTrackIdx = i;
          break;
        }
      }
      outputEventsByTrack[targetTrackIdx].push(...timingEvents);
    }

    // Conversion absolute -> relative
    const outputTracks = outputEventsByTrack.map((events, idx) => {
      const sorted = [...events].sort(compareEvents);
      const lastTime = sorted.length > 0 ? sorted[sorted.length - 1].absoluteTime : 0;
      const endTime = Math.max(scaleTick(trackInfos[idx].endTime, sourceTicksPerBeat, TARGET_TICKS_PER_BEAT), lastTime);
      let previousTime = 0;

      const deltaEvents = sorted.map((event) => {
        const deltaTime = event.absoluteTime - previousTime;
        previousTime = event.absoluteTime;
        return { ...withoutRuntimeFields(event), deltaTime };
      });

      deltaEvents.push({ deltaTime: endTime - lastTime, meta: true, type: "endOfTrack" });
      return deltaEvents;
    });

    return {
      header: {
        ...inputMidi.header,
        format: 1,
        ticksPerBeat: TARGET_TICKS_PER_BEAT,
        numTracks: outputTracks.length
      },
      tracks: outputTracks
    };
  }

  // Exportation globale
  global.cleanMidi = cleanMidi;

})(typeof window !== 'undefined' ? window : this);
