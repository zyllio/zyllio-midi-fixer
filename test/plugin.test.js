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
});
