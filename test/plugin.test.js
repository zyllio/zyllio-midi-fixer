const { loadPlugin } = require("./helpers/load-plugin");

function noteTrack(name, channel = 4) {
  return [
    { deltaTime: 0, type: "trackName", text: name },
    { deltaTime: 0, type: "noteOn", channel, noteNumber: 60, velocity: 80 },
    { deltaTime: 480, type: "noteOff", channel, noteNumber: 60, velocity: 0 },
    { deltaTime: 0, meta: true, type: "endOfTrack" }
  ];
}

function eventsOfType(track, type) {
  return track.filter((event) => event.type === type);
}

function absoluteEvents(track) {
  let absoluteTime = 0;
  return track.map((event) => {
    absoluteTime += event.deltaTime || 0;
    return { ...event, absoluteTime };
  });
}

function labelColumnSignature(track) {
  const columns = new Map();
  absoluteEvents(track)
    .filter((event) =>
      event.type === "noteOn" &&
      event.velocity === 1 &&
      event.noteNumber >= 116
    )
    .forEach((event) => {
      const notes = columns.get(event.absoluteTime) || [];
      notes.push(event.noteNumber);
      columns.set(event.absoluteTime, notes);
    });

  return [...columns.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, notes]) => notes.sort((a, b) => b - a).join(","))
    .join("|");
}

describe("plugin cleanMidi", () => {
  test("does not expose a keep-names option", () => {
    const { registered } = loadPlugin();

    const keepNames = registered[0].metadata.properties.find((property) => property.id === "keep-names");

    expect(keepNames).toBeUndefined();
  });

  test("does not expose a target ticks per beat option", () => {
    const { registered } = loadPlugin();

    const targetTicksPerBeat = registered[0].metadata.properties.find((property) => property.id === "target-ticks-per-beat");

    expect(targetTicksPerBeat).toBeUndefined();
  });

  test("does not expose a pitch bend option", () => {
    const { registered } = loadPlugin();

    const keepPitchBend = registered[0].metadata.properties.find((property) => property.id === "keep-pb");

    expect(keepPitchBend).toBeUndefined();
  });

  test("does not expose a dedupe notes option", () => {
    const { registered } = loadPlugin();

    const dedupeNotes = registered[0].metadata.properties.find((property) => property.id === "dedupe-notes");

    expect(dedupeNotes).toBeUndefined();
  });

  test("always keeps track names", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [noteTrack("Piano")]
    });

    expect(eventsOfType(output.tracks[0], "trackName")).toEqual([
      { deltaTime: 0, type: "trackName", text: "Piano" }
    ]);
    expect(output.header.ticksPerBeat).toBe(960);
  });

  test("uses track names to keep percussion on MIDI channel 10", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [noteTrack("Drums", 2)]
    });

    expect(eventsOfType(output.tracks[0], "noteOn")[0].channel).toBe(9);
  });

  test("ignores melodic tracks when no unique melodic channel remains", () => {
    const { cleanMidi } = loadPlugin();
    const tracks = Array.from({ length: 16 }, (_, index) => noteTrack(`Instrument ${index + 1}`));
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: tracks.length },
      tracks
    });

    expect(eventsOfType(output.tracks[14], "noteOn")).toHaveLength(1);
    expect(eventsOfType(output.tracks[14], "noteOn")[0].channel).toBe(15);
    expect(eventsOfType(output.tracks[15], "noteOn")).toEqual([]);
  });

  test("can remove lead vocal tracks while keeping backing vocals", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 3 },
      tracks: [
        noteTrack("Axl Rose | Lead Vocals"),
        noteTrack("Orchestra | Backing Vocals"),
        noteTrack("Guitar")
      ]
    }, { removeLeadVocals: true });

    expect(eventsOfType(output.tracks[0], "noteOn")).toEqual([]);
    expect(eventsOfType(output.tracks[1], "noteOn")).toHaveLength(1);
    expect(eventsOfType(output.tracks[2], "noteOn")).toHaveLength(1);
  });

  test("removes lead vocal tracks by default", () => {
    const { cleanMidi, registered } = loadPlugin();
    const removeLeadVocals = registered[0].metadata.properties.find((property) => property.id === "remove-lead-vocals");
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 2 },
      tracks: [
        noteTrack("Lead Vocals"),
        noteTrack("Guitar")
      ]
    });

    expect(removeLeadVocals.default).toBe(true);
    expect(eventsOfType(output.tracks[0], "noteOn")).toEqual([]);
    expect(eventsOfType(output.tracks[1], "noteOn")).toHaveLength(1);
  });

  test("can keep lead vocal tracks when explicitly disabled", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [noteTrack("Lead Vocals")]
    }, { removeLeadVocals: false });

    expect(eventsOfType(output.tracks[0], "noteOn")).toHaveLength(1);
  });

  test("can remove chant tracks", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 2 },
      tracks: [
        noteTrack("Chant"),
        noteTrack("Choeur")
      ]
    }, { removeLeadVocals: true });

    expect(eventsOfType(output.tracks[0], "noteOn")).toEqual([]);
    expect(eventsOfType(output.tracks[1], "noteOn")).toHaveLength(1);
  });

  test("does not draw track labels by default", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [noteTrack("Lead Vocals")]
    });

    const labelNotes = absoluteEvents(output.tracks[0]).filter((event) =>
      event.type === "noteOn" &&
      event.velocity === 1 &&
      event.noteNumber >= 116
    );

    expect(labelNotes).toEqual([]);
  });

  test("can draw a visible piano roll label at the start of a track", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [noteTrack("Guitar")]
    }, { drawTrackLabels: true });

    const labelNotes = absoluteEvents(output.tracks[0]).filter((event) =>
      event.type === "noteOn" &&
      event.velocity === 1 &&
      event.noteNumber >= 116
    );

    expect(labelNotes.length).toBeGreaterThan(0);
    expect(labelNotes[0]).toMatchObject({
      absoluteTime: 0,
      channel: 0,
      noteNumber: 120,
      velocity: 1
    });
    expect(Math.max(...labelNotes.map((event) => event.absoluteTime))).toBeGreaterThanOrEqual(2400);
  });

  test.each([
    ["D", "120,119,118,117,116|120,116|119,118,117"],
    ["V", "120,119,118,117|116|120,119,118,117"],
    ["K", "120,119,118,117,116|119,117|120,116"],
    ["I", "120,116|120,119,118,117,116|120,116"],
    ["G", "120,119,118,117|120,116|120,118,117,116"],
    ["T", "120|120,119,118,117,116|120"]
  ])("draws the %s label glyph clearly", (label, expectedSignature) => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [noteTrack(label)]
    }, { drawTrackLabels: true });

    expect(labelColumnSignature(output.tracks[0])).toBe(expectedSignature);
  });

  test.each(["D", "V", "K", "I", "G", "T"])("keeps the %s label glyph three columns wide", (label) => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [noteTrack(label)]
    }, { drawTrackLabels: true });

    const labelTimes = new Set(absoluteEvents(output.tracks[0])
      .filter((event) =>
        event.type === "noteOn" &&
        event.velocity === 1 &&
        event.noteNumber >= 116
      )
      .map((event) => event.absoluteTime));

    expect([...labelTimes]).toHaveLength(3);
    expect(Math.max(...labelTimes)).toBe(480);
  });

  test("keeps each label pixel as a distinct note", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [noteTrack("Backing Vocals")]
    }, { drawTrackLabels: true });

    const firstGlyphC9NoteOns = absoluteEvents(output.tracks[0]).filter((event) =>
      event.type === "noteOn" &&
      event.velocity === 1 &&
      event.noteNumber === 120 &&
      event.absoluteTime < 720
    );

    expect(firstGlyphC9NoteOns.map((event) => event.absoluteTime)).toEqual([0, 240]);
  });

  test("uses detailed label mappings instead of broad string labels", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 4 },
      tracks: [
        noteTrack("Orchestra | violin sect. 1"),
        noteTrack("Orchestra | viola sect 1"),
        noteTrack("Orchestra | Cello"),
        noteTrack("Orchestra | Pizzicato Strings")
      ]
    }, { drawTrackLabels: true });

    const signatures = output.tracks.map(labelColumnSignature);

    expect(new Set(signatures).size).toBe(4);
  });

  test("keeps only useful pitch bend changes", () => {
    const { cleanMidi } = loadPlugin();
    const output = cleanMidi({
      header: { format: 1, ticksPerBeat: 480, numTracks: 1 },
      tracks: [[
        { deltaTime: 0, type: "trackName", text: "Lead" },
        { deltaTime: 0, type: "pitchBend", channel: 4, value: 0 },
        { deltaTime: 10, type: "pitchBend", channel: 4, value: 1200 },
        { deltaTime: 5, type: "pitchBend", channel: 4, value: 1200 },
        { deltaTime: 5, type: "pitchBend", channel: 4, value: 0 },
        { deltaTime: 5, type: "pitchBend", channel: 4, value: 0 },
        { deltaTime: 0, type: "noteOn", channel: 4, noteNumber: 60, velocity: 80 },
        { deltaTime: 480, type: "noteOff", channel: 4, noteNumber: 60, velocity: 0 },
        { deltaTime: 0, meta: true, type: "endOfTrack" }
      ]]
    });

    const pitchBends = eventsOfType(output.tracks[0], "pitchBend");

    expect(pitchBends.map((event) => event.value)).toEqual([1200, 0]);
    expect(pitchBends.map((event) => event.channel)).toEqual([0, 0]);
  });
});
