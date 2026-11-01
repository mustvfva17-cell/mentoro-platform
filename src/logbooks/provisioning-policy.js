/**
 * Product policy: admin provisioning opens the specialty logbook immediately.
 * Trainee access is available as soon as the provisioning transaction commits.
 * Training enrollments remain separate and may later reference this same logbook.
 */
export const LOGBOOK_PROVISIONING_POLICY = Object.freeze({
  actor: "platform_admin",
  activation: "immediate",
  traineeVisibility: "immediately_after_commit",
  cardinality: "one_per_trainee_per_specialty",
  repeatAssignment: "return_existing_without_reset",
  enrollmentRequiredForVisibility: false,
  traineeSelfProvisioning: false,
  mentorScope: "assigned_training_context_only",
});
