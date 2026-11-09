# Rollback plan

## Test correction

- **File:** `tests/ui.test.mjs`
- **Original:** `assert.doesNotMatch(navigation, /worker\/applications#chats|useSyncExternalStore/);`
- **New:** `assert.doesNotMatch(navigation, /worker\/applications#chats/);`
- **Reason:** The broad pattern rejected the viewport subscription hook used by the responsive navigation, although it did not indicate a legacy chat destination.
- **Risk:** The assertion no longer rejects unrelated uses of `useSyncExternalStore`; the targeted test continues to reject the legacy destination.
- **Impact:** Test coverage only; no application behavior or database objects changed.
- **Dependencies:** Existing responsive viewport subscription in `app/components/mobile-bottom-nav.tsx`.
- **Rollback:** Restore the original assertion shown above, then rerun `node --test --test-name-pattern="worker applications screen reuses shared identity" tests/ui.test.mjs`.

## Baseline artifact

- **File:** `STABILIZATION_BASELINE.md`
- **Original:** Absent.
- **New:** Logical manifest of in-scope file hashes, modification times, Git status, and tool versions captured before the test correction.
- **Reason:** Preserve a verifiable pre-correction snapshot.
- **Risk / impact:** Documentation only; hashes do not contain a copy of file contents.
- **Dependencies:** None.
- **Rollback:** Remove `STABILIZATION_BASELINE.md` if the baseline is no longer needed.
