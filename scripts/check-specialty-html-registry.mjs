import assert from 'node:assert/strict';
import { listSpecialtyModules } from '../src/logbooks/module-registry.js';

const modules = listSpecialtyModules();
const ids = modules.map((module) => module.id);
assert.equal(modules.length, 6, 'The central registry must contain six specialty modules.');
assert.equal(new Set(ids).size, ids.length, 'Specialty IDs must be unique.');

const htmlModules = modules.filter((module) => module.renderer === 'HTML');
const htmlPaths = htmlModules.map((module) => module.htmlPath);
assert.equal(new Set(htmlPaths).size, htmlPaths.length, 'HTML runtime paths must be unique.');

assert.deepEqual(
  new Set(htmlPaths),
  new Set([
    '/logbooks/general-surgery/index.html',
    '/logbooks/medical-oncology/index.html',
    '/logbooks/cardiology/index.html',
    '/logbooks/neurology/index.html',
    '/logbooks/pediatrics/index.html'
  ]),
  'Only the five currently integrated HTML runtime pages may be registered.'
);

for (const module of htmlModules) {
  assert.ok(module.htmlPath.startsWith(`/logbooks/${module.id}/`),
    `${module.id} HTML runtime must remain inside its own public logbook path.`);
  assert.equal(module.supportsMentorReview, true,
    `${module.id} must declare mentor review support explicitly.`);
  assert.equal(module.readOnlyMentorReview, true,
    `${module.id} mentor review must remain read-only.`);
}

for (const module of modules.filter((candidate) => candidate.renderer !== 'HTML')) {
  assert.equal(module.htmlPath, undefined,
    `${module.id} must not claim an HTML runtime before one is ported.`);
}

console.log('Specialty registry contract passed: six modules, five registered HTML runtimes.');
