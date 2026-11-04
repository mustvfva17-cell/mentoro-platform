import assert from 'node:assert/strict';
import { listSpecialtyModules } from '../src/logbooks/module-registry.js';

const modules = listSpecialtyModules();
const ids = modules.map((module) => module.id);
assert.equal(modules.length, 7, 'The central registry must contain seven specialty modules.');
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
    '/logbooks/pediatrics/index.html',
    '/logbooks/anesthesia-icu/index.html',
    '/logbooks/ophthalmology/index.html'
  ]),
  'Only currently integrated HTML runtime pages may be registered.'
);

for (const module of htmlModules) {
  const routeSlug = module.id === 'anaesthesia-critical-care' ? 'anesthesia-icu' : module.id;
  assert.ok(module.htmlPath.startsWith(`/logbooks/${routeSlug}/`),
    `${module.id} HTML runtime must remain inside its registered public logbook path.`);
  assert.equal(module.supportsMentorReview, true,
    `${module.id} must declare mentor review support explicitly.`);
  assert.equal(module.readOnlyMentorReview, true,
    `${module.id} mentor review must remain read-only.`);
}

const ophthalmology = modules.find((module) => module.id === 'ophthalmology');
assert.ok(ophthalmology, 'Ophthalmology must be registered.');
assert.equal(ophthalmology.lifecycle, 'draft', 'Ophthalmology must remain draft pending clinical review.');
assert.equal(ophthalmology.renderer, 'HTML');
assert.equal(ophthalmology.htmlPath, '/logbooks/ophthalmology/index.html');

const anesthesia = modules.find((module) => module.id === 'anaesthesia-critical-care');
assert.ok(anesthesia, 'Anesthesia & Critical Care must be registered.');
assert.equal(anesthesia.lifecycle, 'draft',
  'Anesthesia & Critical Care must remain draft pending clinical review.');
assert.equal(anesthesia.renderer, 'HTML');
assert.equal(anesthesia.htmlPath, '/logbooks/anesthesia-icu/index.html');

for (const module of modules.filter((candidate) => candidate.renderer !== 'HTML')) {
  assert.equal(module.htmlPath, undefined,
    `${module.id} must not claim an HTML runtime before one is ported.`);
}

console.log('Specialty registry contract passed: seven modules, seven registered HTML runtimes.');
