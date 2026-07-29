const fs = require("fs");
const path = require("path");
const { loadPlugin } = require("./helpers/load-plugin");

const inputDir = path.join(__dirname, "fixtures", "input");
const outputDir = path.join(__dirname, "fixtures", "output");

const fixtures = fs.readdirSync(inputDir)
  .filter((fileName) => /\.mid$/i.test(fileName))
  .sort();

async function importPluginRuntimeModule(specifier) {
  if (specifier !== "https://esm.sh/midi-file") {
    throw new Error(`Unexpected dynamic import: ${specifier}`);
  }

  const entryUrl = "https://esm.sh/midi-file?bundle";
  const entrySource = await fetchText(entryUrl);
  const bundledPath = entrySource.match(/["'](\/[^"']+bundle\.mjs)["']/)?.[1];
  const source = bundledPath
    ? await fetchText(new URL(bundledPath, entryUrl).href)
    : entrySource;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

  return import(dataUrl);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

class TestFile {
  constructor(parts, name, options = {}) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
    this.lastModified = options.lastModified;
  }

  async arrayBuffer() {
    const buffer = Buffer.concat(this.parts.map((part) => Buffer.from(part)));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
}

describe("clean MIDI generation fixtures", () => {
  beforeAll(() => {
    fs.mkdirSync(outputDir, { recursive: true });
  });

  test.each(fixtures)("generates %s clean version through the plugin action", async (fileName) => {
    const inputPath = path.join(inputDir, fileName);
    const outputPath = path.join(outputDir, fileName.replace(/\.mid$/i, "-clean.mid"));
    const inputBytes = fs.readFileSync(inputPath);

    const { registered } = loadPlugin({
      context: {
        File: TestFile,
        fetch: async () => ({
          ok: true,
          arrayBuffer: async () => inputBytes.buffer.slice(inputBytes.byteOffset, inputBytes.byteOffset + inputBytes.byteLength)
        })
      },
      importModuleDynamically: importPluginRuntimeModule
    });

    const action = new registered[0].ActionClass();
    action.fileUrl = `fixture://${fileName}`;
    action.storageService = {
      uploadFile: async (file) => {
        fs.writeFileSync(outputPath, Buffer.from(await file.arrayBuffer()));
        return outputPath;
      }
    };

    const result = await action.execute();
    const outputBytes = fs.readFileSync(outputPath);

    expect(result).toBe("complete");
    expect(action.value).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(outputBytes.length).toBeGreaterThan(0);
  });
});
