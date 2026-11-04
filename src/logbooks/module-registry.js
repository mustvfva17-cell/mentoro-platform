/**
 * Central specialty module catalogue.
 * Registration does not grant trainee access; a module appears only through
 * a logbook instance linked to that trainee's specific training enrollment.
 */
import generalSurgery from "../specialties/general-surgery/manifest.js";
import medicalOncology from "../specialties/medical-oncology/manifest.js";
import cardiology from "../specialties/cardiology/manifest.js";
import neurology from "../specialties/neurology/manifest.js";
import pediatrics from "../specialties/pediatrics/manifest.js";
import anesthesiaIcu from "../specialties/anesthesia-icu/manifest.js";
import ophthalmology from "../specialties/ophthalmology/manifest.js";

const modules = [
  generalSurgery,
  medicalOncology,
  cardiology,
  neurology,
  pediatrics,
  anesthesiaIcu,
  ophthalmology,
];

const byId = new Map(modules.map((module) => [module.id, module]));

if (byId.size !== modules.length) {
  throw new Error("Duplicate specialty module id in central registry.");
}

export function listSpecialtyModules() {
  return [...modules];
}

export function getSpecialtyModule(specialtyId) {
  const module = byId.get(specialtyId);
  if (!module) throw new Error(`Unknown specialty module: ${specialtyId}`);
  return module;
}

export function listAssignableSpecialtyModules() {
  return modules.filter((module) => module.lifecycle === "published");
}
