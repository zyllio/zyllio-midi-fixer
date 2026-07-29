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
