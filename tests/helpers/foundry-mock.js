export function installFoundryMock() {
  let id = 0;
  globalThis.foundry = {
    utils: {
      deepClone: (value) => structuredClone(value),
      randomID: () => `mock${++id}`
    }
  };
  const modules = new Map();
  globalThis.game = { modules };
  return { modules };
}
