/**
 * Every training enrollment owns one independent logbook instance.
 * Admin provisioning creates the enrollment and its logbook atomically;
 * trainee visibility begins only after that transaction commits.
 */
export const LOGBOOK_PROVISIONING_POLICY = Object.freeze({
  actor: "platform_admin",
  activation: "atomic_with_enrollment",
  traineeVisibility: "immediately_after_commit",
  cardinality: "one_per_enrollment",
  repeatAssignment: "new_enrollment_creates_new_logbook",
  enrollmentRequiredForVisibility: true,
  traineeSelfProvisioning: false,
  mentorScope: "assigned_enrollment_only",
});
