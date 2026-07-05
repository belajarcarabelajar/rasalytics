const Module = require("module");
const _origLoad = Module._load;
Module._load = function (id: string, parent: any, isMain: boolean) {
  if (id.includes("sharp")) {
    const mockSharp = function () {
      return {
        resize: () => mockSharp(),
        toBuffer: async () => Buffer.alloc(0),
      };
    };
    return mockSharp;
  }
  return _origLoad.call(this, id, parent, isMain);
};
