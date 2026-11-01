/**
 * Validates the identity context required by every shared logbook module.
 * A logbook is owned by one trainee-specialty pair, never by a booking.
 */
export function createLogbookContext(input) {
  const required = ["logbookId", "traineeId", "specialtyId", "templateVersionId"];
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
    // Optional current training context; it must not redefine logbook ownership.
    enrollmentId: input.enrollmentId ?? null,
    accessMode: input.accessMode ?? "trainee",
  });
}
