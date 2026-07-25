#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseMidi, writeMidi } = require("midi-file");

const OUTPUT_FORMAT = 1;
const TARGET_TICKS_PER_BEAT = 960;
const PERCUSSION_CHANNEL = 9;
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

function printUsage() {
  console.log("Usage: node split-midi.js <input.mid> [output.mid]");
}

function parseCliArgs(argv) {
  if (argv.some((arg) => arg.startsWith("--"))) {
    throw new Error("Options are not supported.");
  }

  if (argv.length < 1 || argv.length > 2) {
    throw new Error("Expected <input.mid> and optional [output.mid].");
  }

  return {
    inputArg: argv[0],
    outputArg: argv[1]
  };
}

function resolveOutputPath(inputPath, outputArg) {
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const defaultFileName = `${baseName}-clean.mid`;

  if (!outputArg) {
    return path.join(path.dirname(inputPath), defaultFileName);
  }

  const resolved = path.resolve(process.cwd(), outputArg);
  const isDirectory = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  if (isDirectory || path.extname(resolved).toLowerCase() !== ".mid") {
    fs.mkdirSync(resolved, { recursive: true });
    return path.join(resolved, defaultFileName);
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function toAbsoluteEvents(track) {
  let absoluteTime = 0;

  return track.map((event, sourceOrder) => {
    absoluteTime += event.deltaTime || 0;
    return { ...event, absoluteTime, sourceOrder };
  });
}

function withoutRuntimeFields(event) {
  const cleanEvent = { ...event };
  delete cleanEvent.absoluteTime;
  delete cleanEvent.deltaTime;
  delete cleanEvent.sourceOrder;
  return cleanEvent;
}

function isPlayableNoteOn(event) {
  return event.type === "noteOn" && event.velocity > 0;
}

function isNoteEnd(event) {
  return event.type === "noteOff" || (event.type === "noteOn" && event.velocity === 0);
}

function isNoteEvent(event) {
  return isPlayableNoteOn(event) || isNoteEnd(event);
}

function isTimingEvent(event) {
  return event.type === "setTempo" || event.type === "timeSignature";
}

function getTimingEventKey(event) {
  return JSON.stringify({
    type: event.type,
    absoluteTime: event.absoluteTime,
    microsecondsPerBeat: event.microsecondsPerBeat,
    numerator: event.numerator,
    denominator: event.denominator,
    metronome: event.metronome,
    thirtyseconds: event.thirtyseconds
  });
}

function getEventPriority(event) {
  if (isTimingEvent(event)) {
    return 0;
  }

  if (isNoteEnd(event)) {
    return 1;
  }

  if (isPlayableNoteOn(event)) {
    return 2;
  }

  return 3;
}

function compareEvents(a, b) {
  if (a.absoluteTime !== b.absoluteTime) {
    return a.absoluteTime - b.absoluteTime;
  }

  const priorityDiff = getEventPriority(a) - getEventPriority(b);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  return (a.sourceOrder || 0) - (b.sourceOrder || 0);
}

function toDeltaEventsWithEnd(events, endTime) {
  const sortedEvents = [...events].sort(compareEvents);
  const lastEventTime = sortedEvents.length > 0
    ? sortedEvents[sortedEvents.length - 1].absoluteTime
    : 0;
  const safeEndTime = Math.max(endTime, lastEventTime);
  let previousTime = 0;

  const deltaEvents = sortedEvents.map((event) => {
    const deltaTime = event.absoluteTime - previousTime;
    previousTime = event.absoluteTime;
    return { ...withoutRuntimeFields(event), deltaTime };
  });

  deltaEvents.push({
    deltaTime: safeEndTime - lastEventTime,
    meta: true,
    type: "endOfTrack"
  });

  return deltaEvents;
}

function getTrackEndTime(events) {
  return events.reduce((endTime, event) => Math.max(endTime, event.absoluteTime), 0);
}

function scaleTick(tick, sourceTicksPerBeat) {
  return Math.round(tick * TARGET_TICKS_PER_BEAT / sourceTicksPerBeat);
}

function getTrackText(track) {
  return track
    .filter((event) => event.type === "trackName" || event.type === "instrumentName" || event.type === "text")
    .map((event) => event.text)
    .filter(Boolean)
    .join(" ");
}

function isPercussionTrack(track, absoluteEvents) {
  const hasPercussionName = /\b(drums?|drumkit|percussion|perc|batterie|bateria|kick|snare|tom|cymbal|charley|hi[- ]?hat|hihat)\b/i.test(getTrackText(track));
  if (hasPercussionName) {
    return true;
  }

  return absoluteEvents.some((event) => isPlayableNoteOn(event) && event.channel === PERCUSSION_CHANNEL);
}

function classifyTracks(midi, sourceTicksPerBeat) {
  return midi.tracks.map((track) => {
    const events = toAbsoluteEvents(track);
    const isInstrument = events.some(isPlayableNoteOn);

    return {
      events,
      endTime: scaleTick(getTrackEndTime(events), sourceTicksPerBeat),
      isInstrument,
      isPercussion: isInstrument && isPercussionTrack(track, events),
      destinationChannel: null,
      sourceTicksPerBeat
    };
  });
}

function allocateChannels(trackInfos) {
  let melodicIndex = 0;

  trackInfos.forEach((trackInfo) => {
    if (!trackInfo.isInstrument) {
      return;
    }

    if (trackInfo.isPercussion) {
      trackInfo.destinationChannel = PERCUSSION_CHANNEL;
      return;
    }

    trackInfo.destinationChannel = MELODIC_CHANNELS[melodicIndex % MELODIC_CHANNELS.length];
    melodicIndex += 1;
  });
}

function getSourceNoteKey(event) {
  return `${event.channel}:${event.noteNumber}`;
}

function pairTrackNotes(trackInfo) {
  const activeNotes = new Map();
  const notes = [];
  const noteEvents = trackInfo.events
    .filter(isNoteEvent)
    .sort(compareEvents);

  noteEvents.forEach((event) => {
    const noteKey = getSourceNoteKey(event);
    const stack = activeNotes.get(noteKey) || [];

    if (isPlayableNoteOn(event)) {
      stack.push(event);
      activeNotes.set(noteKey, stack);
      return;
    }

    if (stack.length === 0) {
      return;
    }

    const startEvent = stack.shift();
    const startTime = scaleTick(startEvent.absoluteTime, trackInfo.sourceTicksPerBeat);
    const endTime = Math.max(
      scaleTick(event.absoluteTime, trackInfo.sourceTicksPerBeat),
      startTime + 1
    );

    notes.push({
      start: startTime,
      end: endTime,
      channel: trackInfo.destinationChannel,
      noteNumber: startEvent.noteNumber,
      velocity: startEvent.velocity,
      startOrder: startEvent.sourceOrder,
      endOrder: event.sourceOrder
    });

    if (stack.length > 0) {
      activeNotes.set(noteKey, stack);
    } else {
      activeNotes.delete(noteKey);
    }
  });

  activeNotes.forEach((stack) => {
    stack.forEach((startEvent) => {
      const startTime = scaleTick(startEvent.absoluteTime, trackInfo.sourceTicksPerBeat);
      notes.push({
        start: startTime,
        end: Math.max(trackInfo.endTime, startTime + 1),
        channel: trackInfo.destinationChannel,
        noteNumber: startEvent.noteNumber,
        velocity: startEvent.velocity,
        startOrder: startEvent.sourceOrder,
        endOrder: startEvent.sourceOrder
      });
    });
  });

  return notes;
}

function getNotePairKey(note) {
  return `${note.start}:${note.end}:${note.channel}:${note.noteNumber}`;
}

function getSameStartNoteKey(note) {
  return `${note.start}:${note.channel}:${note.noteNumber}`;
}

function dedupeDuplicateNotes(notes) {
  const notesByKey = new Map();

  notes.forEach((note) => {
    const key = getNotePairKey(note);
    const existing = notesByKey.get(key);

    if (!existing || note.velocity > existing.velocity) {
      notesByKey.set(key, note);
    }
  });

  const dedupedByStart = new Map();

  notesByKey.forEach((note) => {
    const key = getSameStartNoteKey(note);
    const existing = dedupedByStart.get(key);

    if (!existing ||
      note.velocity > existing.velocity ||
      (note.velocity === existing.velocity && note.end > existing.end)) {
      dedupedByStart.set(key, note);
    }
  });

  return [...dedupedByStart.values()];
}

function shortenOverlappingSameNotes(notes) {
  const groups = new Map();

  notes.forEach((note) => {
    const key = `${note.channel}:${note.noteNumber}`;
    const group = groups.get(key) || [];
    group.push(note);
    groups.set(key, group);
  });

  const notesToRemove = new Set();

  groups.forEach((group) => {
    group.sort((a, b) => a.start - b.start || a.end - b.end);

    for (let index = 0; index < group.length - 1; index += 1) {
      const note = group[index];
      const nextNote = group[index + 1];

      if (note.end < nextNote.start) {
        continue;
      }

      const adjustedEnd = nextNote.start - 1;
      if (adjustedEnd <= note.start) {
        notesToRemove.add(note);
      } else {
        note.end = adjustedEnd;
      }
    }
  });

  return notes.filter((note) => !notesToRemove.has(note));
}

function buildNoteEvents(notes) {
  return notes.flatMap((note) => [
    {
      absoluteTime: note.start,
      sourceOrder: note.startOrder,
      type: "noteOn",
      channel: note.channel,
      noteNumber: note.noteNumber,
      velocity: note.velocity
    },
    {
      absoluteTime: note.end,
      sourceOrder: note.endOrder,
      type: "noteOff",
      channel: note.channel,
      noteNumber: note.noteNumber,
      velocity: 0
    }
  ]);
}

function collectTimingEvents(trackInfos) {
  const seen = new Set();
  const timingEvents = [];

  trackInfos.forEach((trackInfo) => {
    trackInfo.events
      .filter(isTimingEvent)
      .sort(compareEvents)
      .forEach((event) => {
        const key = getTimingEventKey(event);
        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        timingEvents.push({
          ...withoutRuntimeFields(event),
          absoluteTime: scaleTick(event.absoluteTime, trackInfo.sourceTicksPerBeat),
          sourceOrder: event.sourceOrder
        });
      });
  });

  return timingEvents.sort(compareEvents);
}

function normalizeTrack(trackInfo) {
  if (!trackInfo.isInstrument) {
    return [];
  }

  let notes = pairTrackNotes(trackInfo);
  notes = dedupeDuplicateNotes(notes);
  notes = shortenOverlappingSameNotes(notes);
  return buildNoteEvents(notes);
}

function normalizeMidi(inputMidi) {
  if (!inputMidi.header.ticksPerBeat) {
    throw new Error("Only ticks-per-beat MIDI files are supported.");
  }

  const trackInfos = classifyTracks(inputMidi, inputMidi.header.ticksPerBeat);
  allocateChannels(trackInfos);

  const outputEventsByTrack = trackInfos.map(normalizeTrack);
  if (outputEventsByTrack.length > 0) {
    outputEventsByTrack[0].push(...collectTimingEvents(trackInfos));
  }

  const outputTracks = outputEventsByTrack.map((events, index) => (
    toDeltaEventsWithEnd(events, trackInfos[index].endTime)
  ));

  return {
    header: {
      ...inputMidi.header,
      format: OUTPUT_FORMAT,
      ticksPerBeat: TARGET_TICKS_PER_BEAT,
      numTracks: outputTracks.length
    },
    tracks: outputTracks
  };
}

function normalizeMidiFile(inputPath, outputPath) {
  const inputMidi = parseMidi(fs.readFileSync(inputPath));
  if (!inputMidi.tracks || inputMidi.tracks.length === 0) {
    throw new Error("No MIDI tracks found in the input file.");
  }

  const outputMidi = normalizeMidi(inputMidi);
  fs.writeFileSync(outputPath, Buffer.from(writeMidi(outputMidi)));
}

function main() {
  let args;

  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), args.inputArg);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const outputPath = resolveOutputPath(inputPath, args.outputArg);

  try {
    normalizeMidiFile(inputPath, outputPath);
    console.log(`Generated: ${outputPath}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

main();
