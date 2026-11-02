/**
 * Validates the identity context required by every shared logbook module.
 * A logbook instance belongs to exactly one training enrollment.
 */
export function createLogbookContext(input) {
  const required = [
    "logbookId",
    "traineeId",
    "specialtyId",
    "templateVersionId",
    "enrollmentId",
  ];
  for (const key of required) {
    if (typeof input?.[key] !== "string" || !input[key].trim()) {
      throw new TypeError(`Missing logbook context field: ${key}`);
    }
  }

  return Object.freeze({
    logbookId: input.logbookId,
    traineeId: input.traineeId,
    specialtyId: input.specialtyId,
    templateVersionId: input.templateVersionId,
    enrollmentId: input.enrollmentId,
    accessMode: input.accessMode ?? "trainee",
  });
}
