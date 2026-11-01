# Specialty modules

Each directory is a centrally registered module. The manifest is catalogue metadata;
the template and schema are placeholders until the corresponding source ZIP has
been audited and ported. A module is not trainee-assignable until its lifecycle
is explicitly changed to `published` after clinical and technical review.

The six registered modules are General Surgery, Medical Oncology, Cardiology,
Neurology, Pediatrics, and Anesthesia & Critical Care.

Do not copy standalone ZIPs wholesale. Port UI and clinical content into this
contract, remove overlapping localStorage persistence, and connect all state
through the shared authenticated logbook API.
