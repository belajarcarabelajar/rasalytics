// Preload: mock sharp module to prevent @xenova/transformers from crashing
// Sharp is only needed for image processing, not text classification
const Module = require("module");
const _origLoad = Module._load;
Module._load = function(id: string, parent: any, isMain: boolean) {
  if (id === "sharp") {
    return function() { return { resize: () => this, toBuffer: async () => Buffer.alloc(0) }; };
  }
  return _origLoad.call(this, id, parent, isMain);
};
