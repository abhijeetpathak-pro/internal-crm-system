const ai = require('../services/ai');
for (const name of ['extractDocumentText', 'parseResume', 'matchCandidate']) {
  if (typeof ai[name] !== 'function') throw new Error(`${name} is not exported`);
}
console.log('AI service exports OK');
