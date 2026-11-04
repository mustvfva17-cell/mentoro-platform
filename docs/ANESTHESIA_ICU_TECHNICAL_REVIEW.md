# Anesthesia & Critical Care Logbook — Technical Safety Review

**Review date:** 2026-11-04  
**Scope:** Source-to-platform content parity, module wiring, cloud-state bridge, and clinical-review readiness.  
**Disposition:** Technical safeguards proposed; **clinical approval remains pending**. No template was published, made assignable, or assigned to a trainee as part of this review.

## 1. Verified source and platform parity

The owner-provided archive `mentoro-anesthesia-critical-care-logbook-project-v1.zip` was compared with the registered platform asset under `public/logbooks/anesthesia-icu/`.

| Check | Result |
|---|---:|
| Roadmap rows | 157 |
| Roadmap groups | 17 |
| Clinical patient-journey prompts | 9 |
| Clinical interpretation prompts | 5 |
| Emergency learning templates | 5 |
| Roadmap Tier distribution | 69 Core / 61 Expanded / 27 Advanced |
| Roadmap Depth distribution | 100 Observed / 40 Discussion / 17 Performed under supervision |
| Duplicate roadmap labels | 0 |
| Roadmap rows covered by group ranges | 157 / 157; no gaps or overlaps |

The registered module manifest points to `/logbooks/anesthesia-icu/index.html`, uses the HTML renderer, declares the central state/review bridge, and remains `lifecycle: draft`. The database template is version 1, status `DRAFT`, `is_assignable = false`, and `is_active = false`.

## 2. Platform integration checks

- The HTML asset path in the module manifest matches the HTML template's `html_path` in the database.
- The specialty is registered through the central module registry; this is not, by itself, permission to assign it.
- Standalone preview state uses a specialty-specific local-storage prefix. The assigned-logbook view requests state from the parent platform and sends changes back through same-origin `postMessage` messages.
- The parent bridge checks the message origin, child window source, and instance UUID before handling load, save, or mentor-review messages.
- The parent uses the authenticated logbook-state RPCs and revision-based saves. Mentor review is handled separately and the mentor view is read-only for trainee entries.
- The emergency and other free-text forms display privacy reminders. This is a user-facing warning, not proof that patient-identifying content is automatically detected or removed.

These checks are source-level; they do not replace authenticated browser end-to-end tests with separate trainee, assigned mentor, and administrator accounts.

## 3. Changes in this PR

The Emergency section is now labeled **Emergency Learning Records**, and the page and emergency-entry form state prominently that these forms are for documenting supervised learning, not real-time clinical decision support. They instruct users to activate the local emergency response, seek senior help, follow current institution-approved protocols, and never delay care to complete a form.

This is a scope/safety-label change only. It does not add treatment instructions, drug doses, or a new clinical algorithm, and it does not change roadmap tiers, depths, frequencies, or emergency clinical content.

## 4. Required specialty review before publication

The original README explicitly leaves Tier, Depth, and Frequency assignments for anesthesiologist/intensivist review. The following items should be resolved and documented by an authorized specialty reviewer before publication.

### Emergency learning templates

1. **Cardiac arrest:** The current red-flag wording combines pulse status and “shockable rhythm” in one checkbox. The reviewer should separate clinical recognition from rhythm classification. The investigations list includes ABG and bedside echo; the reviewer should make clear that any adjunct must not interrupt high-quality CPR or timely defibrillation. The 2025 AHA ALS guideline says POCUS may be considered only when it does not interrupt resuscitative efforts, while the benefit of ABG measurement during CPR is uncertain.
2. **Septic shock:** “Lactate above 2 mmol/L” is currently presented as an independent red flag. Review this wording against the 2026 Surviving Sepsis Campaign adult guideline: sepsis is a clinical diagnosis and should not be ruled in or out using a single biomarker; lactate measurement is suggested as part of assessment. Blood cultures should be obtained promptly and ideally before antimicrobials, without delaying time-critical treatment. The form should remain a learning record, not a sepsis bundle.
3. **Difficult / failed airway:** The red flags identify failed oxygenation/intubation states but do not remind the trainee to call for help, prioritize oxygenation, limit repeated attempts, or refer to the approved local difficult-airway algorithm. The reviewer should confirm the language against the institution's adopted airway pathway and the ASA difficult-airway guideline.
4. **Anaphylaxis:** Serum tryptase appears in the investigation list. Ensure the form describes it as a supportive investigation and does not imply that sampling should delay treatment. Confirm that the learning content reflects prompt intramuscular adrenaline as first-line treatment and the current acute/baseline tryptase approach.
5. **Acute respiratory failure:** Confirm that the learning prompts distinguish hypoxaemic from hypercapnic failure, include appropriate escalation/monitoring concepts, and do not encourage an NIV pathway where it is contraindicated or unsafe.

### Roadmap and scope

- Revalidate every Tier / Depth / Frequency classification for the intended MENTORO learner level (medical student / intern / junior doctor), training environment, and local scope of practice.
- Specifically review the 17 items classified as “Performed under supervision”; distinguish simulation from patient-facing practice and specify required direct supervision where relevant.
- Confirm local consent/chaperone expectations, fasting guidance, pediatric and pregnancy-related exposure, geriatric/frail patients, invasive procedures, blood products, end-of-life care, and death-by-neurologic-criteria content.
- Check for intentional cross-group repetition (for example, anaphylaxis recognition vs. management and cardiac-arrest recognition vs. ALS discussion) so the same experience is not accidentally double-counted as separate competence.
- Keep the platform's core distinction: exposure documentation and mentor feedback do not certify independent competence, privileges, or authorization to perform a procedure.

## 5. External clinical references for reviewer use

- [2025 AHA Guidelines — Part 9: Adult Advanced Life Support](https://cpr.heart.org/en/resuscitation-science/cpr-and-ecc-guidelines/adult-advanced-life-support/)
- [Surviving Sepsis Campaign — 2026 Adult Guidelines](https://sccm.org/survivingsepsiscampaign/guidelines-and-resources/surviving-sepsis-campaign-adult-guidelines)
- [ASA 2022 Practice Guidelines for Management of the Difficult Airway](https://doi.org/10.1097/ALN.0000000000004002)
- [2023 AAAAI/ACAAI Anaphylaxis Practice Parameter Update](https://www.aaaai.org/Aaaai/media/Media-Library-PDFs/Allergist-Resources/Statements-and-Practice-Parameters/Anaphylaxis-Practice-Paramaters-2023.pdf)
- [EAACI Anaphylaxis Guideline (2021 update)](https://eaaci.org/guidelines-position-papers/eaaci-guidelines-anaphylaxis-2021-update/)

The reviewer should record the guideline edition and local protocol used, the name/role of the reviewer, date, decisions, and any limitations. A generic “approved” note without a traceable specialty review is not sufficient.

## 6. Release gate

Keep this version in `DRAFT` and `is_assignable = false` until all of the following are true:

- A named anesthesiologist/intensivist completes and documents the specialty review above.
- Any content changes are incorporated as a new immutable template version and rechecked against the HTML asset.
- The trainee, assigned mentor, and administrator flows pass authenticated end-to-end tests, including autosave, revision conflict, read-only review, and enrollment-level access boundaries.
- The authorized platform administrator publishes the reviewed version through the guarded database workflow.

**No clinical approval or release is implied by this technical review or by the safety-label changes in this PR.**
