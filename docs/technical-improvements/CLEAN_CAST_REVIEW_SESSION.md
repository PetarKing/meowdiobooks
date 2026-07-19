# Keep unchanged Cast review sessions complete

**Status:** Follow-up; not implemented.

Opening a completed Cast & Voices step currently creates an immutable candidate and immediately marks
the step `Draft ready`, even when the user only browses the existing cast and voices.

Treat the reopened step as a clean review session. Keep it complete until cast settings, voice
selections, routes or auditions diverge from the session baseline; provide **Done reviewing** for a
clean exit; and keep dirty detection centralized across the Cast and Voices views.
