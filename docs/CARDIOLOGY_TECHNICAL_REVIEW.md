# Cardiology Logbook — Technical Integration and Safety Review

**Review date:** 2026-11-04  
**Scope:** Source-to-platform catalogue parity, roadmap grouping, HTML runtime bridge, privacy messaging, and specialty-review readiness.  
**Disposition:** Technical integration checks completed; **cardiologist approval remains pending**. No template was published or assigned.

## 1. Verified catalogue

The owner-provided `mentoro-cardiology-logbook-project-v1.zip` source and the central platform catalogue were inspected.

| Check | Result |
|---|---:|
| Roadmap items | 117 |
| Roadmap groups | 13 |
| Patient Journey prompts | 9 |
| Clinical Interpretation prompts | 5 |
| Emergency learning templates | 5 |
| Tier distribution | 60 Core / 39 Expanded / 18 Advanced |
| Depth distribution | 71 Observed / 30 Discussion / 16 Performed under supervision |
| Frequency distribution | 42 Repeated / 75 Single |
| Duplicate roadmap labels | 0 |
| Group range coverage | 117 / 117, with no gaps or overlaps |

The emergency catalogue contains:
- Acute Coronary Syndrome
- Acute Heart Failure / Pulmonary Edema
- Unstable Arrhythmia / Cardiac Arrest
- Hypertensive Emergency
- Acute Pulmonary Embolism

## 2. Platform integration

- The central module manifest uses the HTML renderer and points to `/logbooks/cardiology/index.html`.
- The HTML page loads its local `app.js` and `style.css`; the app loads `content.json` with `cache: no-store`.
- Initialization rejects a catalogue whose roadmap array is not exactly 117 rows.
- The runtime uses an instance-specific local-storage namespace and the central same-origin `postMessage` bridge for cloud load/save and mentor review.
- The parent/child bridge checks origin, opener source, and instance ID; the central parent performs authenticated RPC reads/writes with revision-aware saves.
- The emergency page already labels its prompts as learning aids, not treatment protocols.
- A general privacy reminder warns users not to enter patient-identifying information.

These are source-level checks; they do not replace authenticated browser end-to-end tests with separate trainee, assigned mentor, and administrator accounts.

## 3. Gap identified and change proposed in this PR

The owner-provided source README explicitly requires patient consent for precordial examination and auscultation, with a chaperone where appropriate. That guidance was not visible in the platform's cardiology UI.

This PR adds a notice that appears only when the trainee selects the **Examination & Procedural Skills** roadmap group. It reminds the trainee to obtain consent, explain the examination, preserve privacy and comfort, use a chaperone where appropriate under local policy, and remain within the trainee's role and supervision.

This is a UI reminder only. It is not a legal consent workflow, chaperone booking record, clinical competency sign-off, or substitute for local policy.

## 4. Required cardiologist review before publication

The source README states that Tier, Depth, and Frequency classifications remain a first clinical draft pending review by a cardiologist. Before publication, the specialty reviewer should:

- Validate every Core / Expanded / Advanced classification and the target exposure level for the intended MENTORO learner population.
- Review all 16 “Performed under supervision” items to ensure the level is suitable for the training context, with explicit scope and supervision expectations.
- Confirm that the 9 patient-journey prompts accurately reflect the local pathway and do not imply that every trainee will participate in every stage.
- Review the 5 emergency learning templates for clinically current terminology, red-flag framing, differential prompts, investigations, and the intended educational—not algorithmic—scope.
- Review the examination and procedural skills section, including consent, chaperone, privacy, and patient-comfort expectations.
- Confirm that exposure logging, mentor verification, and any “Core” labels are never presented as proof of competence, clinical privileges, or authorization for independent practice.

The reviewer should record their name and specialty role, date, references/local policy used, decisions, and limitations. A generic approval note without traceable specialty review is insufficient.

## 5. Release gate

Keep the template version in `DRAFT` and `is_assignable = false` until:
1. A named cardiologist completes the clinical review above.
2. Any resulting content changes are committed as a new immutable version and rechecked against the HTML runtime.
3. Authenticated end-to-end tests pass for trainee access, assigned-mentor read-only review, admin oversight, instance-level ownership, cloud autosave, and revision conflicts.
4. The authorized platform administrator publishes the reviewed version through the guarded database workflow.

**This technical review and the consent/chaperone UI reminder do not constitute clinical approval or authorize publication.**
